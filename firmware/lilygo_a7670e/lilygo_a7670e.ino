/*
 * LilyGO T-A7670E — MRI Magnet Monitor Firmware
 *
 * Connectivity model:
 *   Primary  — WiFi → WebSocket (wss://<SERVER_HOST>/ws)
 *   Fallback — A7670E cellular modem → SMS only via AT+CMGS
 *              (used when WiFi is down OR on quench regardless of WiFi)
 *
 * Provisioning:
 *   On first boot (no config in NVS), opens a WiFi hotspot "MRI-Monitor"
 *   with password c87b5bbb5f19. Connect any phone/laptop to that network.
 *   Browser opens automatically (captive portal) — or go to 192.168.4.1.
 *   Fill in WiFi SSID, password, device secret → Save → device reboots.
 *
 * Hardware:
 *   UART0  GPIO3 RX / GPIO1 TX  — RS-232 from MRI @ 9600 baud
 *   UART1  GPIO27 RX / GPIO26 TX — A7670E AT commands @ 115200 baud
 *   UART2  GPIO16 RX / GPIO17 TX — Debug output @ 115200 baud
 *   GPIO32 X119 PIN1 general alarm  INPUT_PULLUP  (LOW = active)
 *   GPIO34 X119 PIN2 secondary alarm INPUT         (HIGH = active)
 *   GPIO35 X119 PIN3 quench CRITICAL INPUT         (HIGH = active)
 *   GPIO36 Battery voltage via 1:1 voltage divider  ADC1 CH0
 *
 * Required libraries (Arduino Library Manager):
 *   WebSockets  by Markus Sattler (Links2004)  >= 2.4.0
 *   ArduinoJson                       >= 7.0
 *   Board: esp32 by Espressif         >= 3.0
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>

// ── Captive portal AP ─────────────────────────────────────────────────────────
#define AP_SSID  "MRI-Monitor"
#define AP_PASS  "c87b5bbb5f19"

static const IPAddress AP_IP(192, 168, 4, 1);
static const IPAddress AP_SUBNET(255, 255, 255, 0);

// ── Hardware pins ─────────────────────────────────────────────────────────────
#define MODEM_TX_PIN   26
#define MODEM_RX_PIN   27
#define MODEM_PWRKEY   4
#define GPIO_ALARM_1   32    // INPUT_PULLUP  LOW = active
#define GPIO_ALARM_2   34    // INPUT         HIGH = active
#define GPIO_QUENCH    35    // INPUT         HIGH = active (CRITICAL)
#define GPIO_VBAT      36    // ADC1 CH0

#define VBAT_RATIO     2.0f
#define ADC_VREF_MV    3300
#define ADC_MAX        4095

// ── Timing ────────────────────────────────────────────────────────────────────
#define SERIAL_FLUSH_MS    100
#define SERIAL_MAX_BYTES   400
#define STATUS_INTERVAL_MS 30000
#define WIFI_RECONNECT_MS  10000
#define WS_RECONNECT_MS    5000
#define CONFIG_INTERVAL_MS 300000
#define GPIO_DEBOUNCE_MS   50

// ── Global objects ────────────────────────────────────────────────────────────
HardwareSerial modemSerial(1);
WiFiClientSecure wifiSecure;
WebSocketsClient ws;
Preferences      prefs;
WebServer        apServer(80);
DNSServer        dnsServer;

// Config loaded from NVS
char cfgSSID[64]           = "";
char cfgWifiPass[64]       = "";
char cfgDeviceSecret[64]   = "";
char cfgSMSRecipients[512] = "[]";
char cfgServerHost[64]     = "magnets.karnagio.org";

// ── Runtime state ─────────────────────────────────────────────────────────────
bool  provisioningMode = false;
bool  wsConnected      = false;
bool  wsStarted        = false;
bool  modemReady       = false;
bool  modemSmsSent     = false;

String        serialBuf      = "";
unsigned long lastSerialMs   = 0;
unsigned long lastStatusMs   = 0;
unsigned long lastWifiMs     = 0;
unsigned long lastConfigMs   = 0;

int  stableAlarm1 = -1, stableAlarm2 = -1, stableQuench = -1;
int  readingAlarm1, readingAlarm2, readingQuench;
unsigned long changeAlarm1Ms = 0, changeAlarm2Ms = 0, changeQuenchMs = 0;

// ── Debug serial ──────────────────────────────────────────────────────────────
#define DBG       Serial2
#define DBG_BAUD  115200
#define DBG_RX    16
#define DBG_TX    17
#define LOG(...)  DBG.printf(__VA_ARGS__)

// ── Captive portal HTML ───────────────────────────────────────────────────────
static const char SETUP_HTML[] PROGMEM = R"rawhtml(
<!DOCTYPE html>
<html lang='el'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>MRI Monitor - Ρύθμιση</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#eee;font-family:system-ui,sans-serif;
     display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#16213e;border-radius:12px;padding:32px;width:100%;
      max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
h1{font-size:1.5rem;color:#e94560;margin-bottom:6px}
.sub{color:#888;font-size:.9rem;margin-bottom:28px;line-height:1.5}
label{display:block;font-size:.82rem;color:#aaa;margin-top:18px;margin-bottom:5px;
      text-transform:uppercase;letter-spacing:.05em}
input{width:100%;padding:11px 14px;background:#0f3460;border:1.5px solid #1a4a8a;
      border-radius:8px;color:#fff;font-size:1rem;transition:border .2s}
input:focus{outline:none;border-color:#e94560}
input::placeholder{color:#555}
button{width:100%;margin-top:28px;padding:13px;background:#e94560;border:none;
       border-radius:8px;color:#fff;font-size:1rem;font-weight:700;cursor:pointer;
       letter-spacing:.03em;transition:background .2s}
button:hover{background:#c73652}
.note{margin-top:18px;color:#666;font-size:.8rem;text-align:center;line-height:1.6}
</style>
</head>
<body>
<div class='card'>
  <h1>&#x1F9B2; MRI Monitor</h1>
  <p class='sub'>Ρύθμιση συσκευής — συμπλήρωσε τα παρακάτω και πάτα Αποθήκευση.</p>
  <form method='POST' action='/save'>
    <label>Όνομα WiFi (SSID)</label>
    <input name='ssid' type='text' placeholder='π.χ. COSMOTE-186964' required autocomplete='off'>
    <label>Κωδικός WiFi</label>
    <input name='pass' type='password' placeholder='κωδικός δικτύου' autocomplete='off'>
    <label>Device Secret</label>
    <input name='secret' type='text' placeholder='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' required autocomplete='off'>
    <button type='submit'>&#x1F4BE; Αποθήκευση &amp; Επανεκκίνηση</button>
  </form>
  <p class='note'>Μετά την αποθήκευση η συσκευή επανεκκινεί<br>και συνδέεται αυτόματα στο WiFi σου.</p>
</div>
</body>
</html>
)rawhtml";

static const char SAVED_HTML[] PROGMEM = R"rawhtml(
<!DOCTYPE html>
<html lang='el'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>MRI Monitor - Αποθηκεύτηκε</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#eee;font-family:system-ui,sans-serif;
     display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#16213e;border-radius:12px;padding:40px 32px;width:100%;
      max-width:420px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4)}
.icon{font-size:3rem;margin-bottom:16px}
h1{font-size:1.4rem;color:#4caf50;margin-bottom:12px}
p{color:#aaa;line-height:1.7}
</style>
</head>
<body>
<div class='card'>
  <div class='icon'>&#x2705;</div>
  <h1>Αποθηκεύτηκε!</h1>
  <p>Τα στοιχεία αποθηκεύτηκαν.<br>
     Η συσκευή επανεκκινεί τώρα<br>
     και συνδέεται στο WiFi σου.</p>
</div>
</body>
</html>
)rawhtml";

// ── Captive portal handlers ───────────────────────────────────────────────────
void handleSetupForm() {
  apServer.send_P(200, "text/html", SETUP_HTML);
}

void handleSave() {
  String ssid   = apServer.arg("ssid");
  String pass   = apServer.arg("pass");
  String secret = apServer.arg("secret");

  if (ssid.length() == 0 || secret.length() == 0) {
    apServer.send(400, "text/plain", "SSID and Secret are required.");
    return;
  }

  prefs.begin("mri", false);
  prefs.putString("ssid",    ssid);
  prefs.putString("wpass",   pass);
  prefs.putString("dsecret", secret);
  prefs.end();

  LOG("[AP] Config saved — SSID='%s' Secret='%s'\n", ssid.c_str(), secret.c_str());

  apServer.send_P(200, "text/html", SAVED_HTML);
  delay(1500);
  ESP.restart();
}

// Redirect anything else to the form (captive portal trigger)
void handleCaptiveRedirect() {
  apServer.sendHeader("Location", "http://192.168.4.1/", true);
  apServer.send(302, "text/plain", "");
}

// ── Start WiFi AP provisioning ────────────────────────────────────────────────
void startAPProvisioning() {
  LOG("[AP] Starting provisioning hotspot '%s'\n", AP_SSID);

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_IP, AP_SUBNET);
  WiFi.softAP(AP_SSID, AP_PASS);

  LOG("[AP] IP: %s\n", WiFi.softAPIP().toString().c_str());

  // DNS: redirect all domains to our IP (captive portal)
  dnsServer.start(53, "*", AP_IP);

  apServer.on("/",        HTTP_GET,  handleSetupForm);
  apServer.on("/save",    HTTP_POST, handleSave);
  apServer.onNotFound(handleCaptiveRedirect);
  apServer.begin();

  LOG("[AP] Web server started — connect to '%s' and open browser\n", AP_SSID);
}

// ── NVS helpers ───────────────────────────────────────────────────────────────
void loadNVS() {
  prefs.begin("mri", true);
  prefs.getString("ssid",    cfgSSID,          sizeof(cfgSSID));
  prefs.getString("wpass",   cfgWifiPass,      sizeof(cfgWifiPass));
  prefs.getString("dsecret", cfgDeviceSecret,  sizeof(cfgDeviceSecret));
  prefs.getString("smsrc",   cfgSMSRecipients, sizeof(cfgSMSRecipients));
  prefs.getString("srvhost", cfgServerHost,    sizeof(cfgServerHost));
  prefs.end();
  // Migrate stale direct-IP host to the Cloudflare-proxied domain (bypasses ISP blocks)
  if (strlen(cfgServerHost) == 0 || strcmp(cfgServerHost, "hetzner.karnagio.org") == 0) {
    strlcpy(cfgServerHost, "magnets.karnagio.org", sizeof(cfgServerHost));
    prefs.begin("mri", false);
    prefs.putString("srvhost", cfgServerHost);
    prefs.end();
  }
}

void saveNVSSMS() {
  prefs.begin("mri", false);
  prefs.putString("smsrc", cfgSMSRecipients);
  prefs.end();
}

// ── Modem ─────────────────────────────────────────────────────────────────────
void modemPowerOn() {
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(5000);
}

bool atCmd(const char *cmd, const char *expect = "OK", unsigned long timeoutMs = 3000) {
  while (modemSerial.available()) modemSerial.read();
  modemSerial.println(cmd);
  unsigned long t = millis();
  String resp = "";
  while (millis() - t < timeoutMs) {
    if (modemSerial.available()) {
      resp += (char)modemSerial.read();
      if (resp.indexOf(expect) >= 0) return true;
      if (resp.indexOf("ERROR") >= 0) { LOG("[AT] ERROR: %s\n", cmd); return false; }
    }
  }
  LOG("[AT] Timeout: %s\n", cmd);
  return false;
}

bool modemInitSMS() {
  if (!modemReady) {
    modemSerial.begin(115200, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
    modemPowerOn();
    if (!atCmd("AT", "OK", 5000)) { LOG("[MODEM] Not responding\n"); return false; }
    atCmd("ATE0");
    atCmd("AT+CMEE=2");
    modemReady = true;
  }
  return atCmd("AT+CMGF=1");
}

void sendSMSToAll(const char *message) {
  if (!modemInitSMS()) return;

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, cfgSMSRecipients) != DeserializationError::Ok) return;
  JsonArray arr = doc.as<JsonArray>();

  for (JsonVariant v : arr) {
    const char *num = v.as<const char *>();
    if (!num || strlen(num) == 0) continue;
    LOG("[SMS] Sending to %s\n", num);

    while (modemSerial.available()) modemSerial.read();
    String cmdStr = "AT+CMGS=\""; cmdStr += num; cmdStr += "\"";
    modemSerial.println(cmdStr);

    unsigned long t = millis(); String resp = ""; bool gotPrompt = false;
    while (millis() - t < 10000) {
      if (modemSerial.available()) {
        resp += (char)modemSerial.read();
        if (resp.indexOf('>') >= 0) { gotPrompt = true; break; }
        if (resp.indexOf("ERROR") >= 0) break;
      }
    }
    if (!gotPrompt) { LOG("[SMS] No prompt for %s\n", num); continue; }

    modemSerial.print(message);
    modemSerial.write(0x1A);

    t = millis(); resp = "";
    while (millis() - t < 30000) {
      if (modemSerial.available()) {
        resp += (char)modemSerial.read();
        if (resp.indexOf("+CMGS:") >= 0 || resp.indexOf("OK") >= 0) {
          LOG("[SMS] Sent to %s\n", num); break;
        }
        if (resp.indexOf("ERROR") >= 0) { LOG("[SMS] Failed to %s\n", num); break; }
      }
    }
    delay(500);
  }
}

// ── Config download ───────────────────────────────────────────────────────────
void downloadConfig() {
  if (WiFi.status() != WL_CONNECTED) return;

  String url = String("https://") + cfgServerHost + "/api/device/config?secret=" + cfgDeviceSecret;
  HTTPClient http;
  wifiSecure.setInsecure();
  http.begin(wifiSecure, url);
  int code = http.GET();
  if (code != 200) { LOG("[CFG] HTTP %d\n", code); http.end(); return; }

  String body = http.getString();
  http.end();

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    LOG("[CFG] JSON error\n"); return;
  }

  if (doc.containsKey("sms_recipients")) {
    String smsJson;
    serializeJson(doc["sms_recipients"], smsJson);
    strlcpy(cfgSMSRecipients, smsJson.c_str(), sizeof(cfgSMSRecipients));
    saveNVSSMS();
  }
  LOG("[CFG] Updated. SMS: %s\n", cfgSMSRecipients);
}

// ── WiFi ──────────────────────────────────────────────────────────────────────
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  LOG("[NET] Connecting to %s...\n", cfgSSID);
  WiFi.begin(cfgSSID, cfgWifiPass);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 20000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    LOG("[NET] WiFi OK  IP=%s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  LOG("[NET] WiFi failed\n");
  return false;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
void onWSEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      LOG("[WS] Connected\n");
      break;
    case WStype_DISCONNECTED:
      wsConnected = false;
      LOG("[WS] Disconnected\n");
      break;
    case WStype_TEXT: {
      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, payload, length) != DeserializationError::Ok) return;
      if (strcmp(doc["type"] | "", "command") == 0)
        Serial.print(doc["cmd"].as<const char *>());
      break;
    }
    default:
      break;
  }
}

void connectWS() {
  String path = String("/ws?secret=") + cfgDeviceSecret;
  ws.onEvent(onWSEvent);
  // No fingerprint/CA given → library calls setInsecure() on its WiFiClientSecure
  ws.beginSSL(cfgServerHost, 443, path.c_str());
  ws.setReconnectInterval(WS_RECONNECT_MS);
  ws.enableHeartbeat(15000, 5000, 2);
  wsStarted = true;
}

// ── JSON send ─────────────────────────────────────────────────────────────────
void wsSend(JsonDocument &doc) {
  if (!wsConnected) return;
  String out; serializeJson(doc, out);
  ws.sendTXT(out);
}

void sendSerialChunk(const String &data) {
  StaticJsonDocument<512> doc;
  doc["type"] = "serial_data";
  doc["data"] = data;
  wsSend(doc);
}

void sendGPIOUpdate(int a1, int a2, int q) {
  StaticJsonDocument<128> doc;
  doc["type"]       = "gpio_update";
  doc["pins"]["32"] = a1;
  doc["pins"]["34"] = a2;
  doc["pins"]["35"] = q;
  wsSend(doc);
}

void sendDeviceStatus() {
  int raw   = analogRead(GPIO_VBAT);
  int adcMV = (long)raw * ADC_VREF_MV / ADC_MAX;
  int batMV = (int)(adcMV * VBAT_RATIO);

  StaticJsonDocument<128> doc;
  doc["type"]        = "status";
  doc["battery_mv"]  = batMV;
  doc["signal_rssi"] = WiFi.RSSI();
  doc["on_mains"]    = (batMV > 4100);
  wsSend(doc);
}

// ── GPIO ──────────────────────────────────────────────────────────────────────
void checkGPIO() {
  unsigned long now = millis();
  int a1 = digitalRead(GPIO_ALARM_1);
  int a2 = digitalRead(GPIO_ALARM_2);
  int q  = digitalRead(GPIO_QUENCH);

  auto track = [&](int cur, int &stable, unsigned long &changedMs) {
    if (cur != stable) { if (changedMs == 0) changedMs = now; }
    else               { changedMs = 0; }
  };
  track(a1, stableAlarm1, changeAlarm1Ms);
  track(a2, stableAlarm2, changeAlarm2Ms);
  track(q,  stableQuench, changeQuenchMs);

  bool changed = false;
  auto commit = [&](int cur, int &stable, unsigned long &changedMs) {
    if (changedMs > 0 && now - changedMs >= GPIO_DEBOUNCE_MS) {
      stable = cur; changedMs = 0; changed = true;
    }
  };
  commit(a1, stableAlarm1, changeAlarm1Ms);
  commit(a2, stableAlarm2, changeAlarm2Ms);
  commit(q,  stableQuench, changeQuenchMs);

  if (!changed) return;

  sendGPIOUpdate(stableAlarm1, stableAlarm2, stableQuench);

  if (stableQuench == HIGH && !modemSmsSent) {
    modemSmsSent = true;
    LOG("[ALERT] *** QUENCH — sending SMS ***\n");
    sendSMSToAll("QUENCH DETECTED on MRI magnet! Immediate action required.");
  }
  if (stableQuench == LOW) modemSmsSent = false;

  if (stableAlarm1 == LOW)  LOG("[ALERT] Alarm 1 active\n");
  if (stableAlarm2 == HIGH) LOG("[ALERT] Alarm 2 active\n");
}

void checkSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\0') serialBuf += c;
    if (serialBuf.length() >= SERIAL_MAX_BYTES) {
      lastSerialMs = millis();
      sendSerialChunk(serialBuf);
      serialBuf = "";
    }
  }
  if (serialBuf.length() > 0 && wsConnected && millis() - lastSerialMs >= SERIAL_FLUSH_MS) {
    lastSerialMs = millis();
    sendSerialChunk(serialBuf);
    serialBuf = "";
  }
}

void checkSMSFallback() {
  if (WiFi.status() == WL_CONNECTED) return;
  if ((stableAlarm1 == LOW || stableAlarm2 == HIGH || stableQuench == HIGH) && !modemSmsSent) {
    modemSmsSent = true;
    sendSMSToAll("MRI Alarm active! WiFi monitor offline. Check device immediately.");
  }
  if (stableAlarm1 == HIGH && stableAlarm2 == LOW && stableQuench == LOW)
    modemSmsSent = false;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  DBG.begin(DBG_BAUD, SERIAL_8N1, DBG_RX, DBG_TX);
  LOG("\n[BOOT] MRI Monitor LilyGO A7670E\n");

  loadNVS();
  LOG("[NVS] SSID='%s'  Secret='%s'\n", cfgSSID, cfgDeviceSecret);

  // Enter WiFi AP provisioning if no credentials saved
  if (strlen(cfgSSID) == 0 || strlen(cfgDeviceSecret) == 0) {
    LOG("[BOOT] No config — starting WiFi AP provisioning\n");
    provisioningMode = true;
    startAPProvisioning();
    return;
  }

  // Normal mode init
  Serial.begin(9600, SERIAL_8N1, 3, 1);

  pinMode(GPIO_ALARM_1, INPUT_PULLUP);
  pinMode(GPIO_ALARM_2, INPUT);
  pinMode(GPIO_QUENCH,  INPUT);
  analogSetAttenuation(ADC_11db);

  stableAlarm1 = digitalRead(GPIO_ALARM_1);
  stableAlarm2 = digitalRead(GPIO_ALARM_2);
  stableQuench = digitalRead(GPIO_QUENCH);

  LOG("[CFG] SMS recipients (cached): %s\n", cfgSMSRecipients);

  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    downloadConfig();
    lastConfigMs = millis();
    connectWS();
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
void loop() {
  // ── WiFi AP provisioning mode ───────────────────────────────────────────────
  if (provisioningMode) {
    dnsServer.processNextRequest();
    apServer.handleClient();
    return;
  }

  // ── Normal operation ────────────────────────────────────────────────────────
  unsigned long now = millis();

  if (wsStarted) ws.loop();  // library handles reconnect internally

  if (WiFi.status() != WL_CONNECTED && now - lastWifiMs >= WIFI_RECONNECT_MS) {
    lastWifiMs = now; wsConnected = false; connectWiFi();
  }

  if (!wsStarted && WiFi.status() == WL_CONNECTED) connectWS();

  if (WiFi.status() == WL_CONNECTED && now - lastConfigMs >= CONFIG_INTERVAL_MS) {
    lastConfigMs = now; downloadConfig();
  }

  checkSerial();
  checkGPIO();
  checkSMSFallback();

  if (wsConnected && now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now; sendDeviceStatus();
  }
}
