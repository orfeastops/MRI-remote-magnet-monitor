/*
 * LilyGO T-A7670E — MRI Magnet Monitor Firmware
 *
 * Connectivity model:
 *   Primary  — WiFi → WebSocket (wss://magnets.karnagio.org/ws)
 *   Fallback — A7670E cellular modem → SMS only via AT+CMGS
 *              (used when WiFi is down OR on quench regardless of WiFi)
 *
 * Hardware:
 *   UART0  GPIO3 RX / GPIO1 TX  — RS-232 from MRI MSUP @ 9600 baud
 *   UART1  GPIO27 RX / GPIO26 TX — A7670E AT commands @ 115200 baud
 *   GPIO32 X119 PIN1 general alarm  INPUT_PULLUP  (LOW = active)
 *   GPIO34 X119 PIN2 secondary alarm INPUT          (HIGH = active)
 *   GPIO35 X119 PIN3 quench CRITICAL INPUT          (HIGH = active)
 *   GPIO36 Battery voltage via 1:1 voltage divider  ADC1 CH0
 *
 * Required libraries (Arduino Library Manager):
 *   ArduinoWebsockets  by Gil Maimon  >= 0.5.4
 *   ArduinoJson                       >= 7.0
 *   Board: esp32 by Espressif         >= 3.0
 *
 * Provisioning — edit DEVICE_SECRET, WIFI_SSID, WIFI_PASS before flashing.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoWebsockets.h>
#include <ArduinoJson.h>
#include <Preferences.h>

using namespace websockets;

// ── Provisioning (edit per device) ───────────────────────────────────────────
#define DEVICE_SECRET    "REPLACE_WITH_DEVICE_SECRET_FROM_SERVER"
#define WIFI_SSID        "REPLACE_WITH_WIFI_SSID"
#define WIFI_PASS        "REPLACE_WITH_WIFI_PASSWORD"
#define SERVER_HOST      "magnets.karnagio.org"
#define SERVER_BASE_URL  "https://" SERVER_HOST

// ── Hardware pins ─────────────────────────────────────────────────────────────
#define MODEM_TX_PIN   26    // ESP32 TX  → A7670E RX
#define MODEM_RX_PIN   27    // ESP32 RX  ← A7670E TX
#define MODEM_PWRKEY   4     // pull LOW ~1 s to power on modem
#define GPIO_ALARM_1   32    // X119 PIN1  INPUT_PULLUP  LOW=active
#define GPIO_ALARM_2   34    // X119 PIN2  INPUT (no pullup) HIGH=active
#define GPIO_QUENCH    35    // X119 PIN3  INPUT (no pullup) HIGH=active
#define GPIO_VBAT      36    // ADC1 CH0 — battery voltage

// Vbat = ADC_reading * 3300 / 4095 * 2  (1:1 divider with 3.3 V ref)
#define VBAT_RATIO     2.0f
#define ADC_VREF_MV    3300
#define ADC_MAX        4095

// ── Timing ────────────────────────────────────────────────────────────────────
#define SERIAL_FLUSH_MS    100    // flush MRI buffer after 100 ms idle
#define SERIAL_MAX_BYTES   400    // or when this many bytes accumulated
#define STATUS_INTERVAL_MS 30000  // device status period
#define WIFI_RECONNECT_MS  10000  // retry WiFi
#define WS_RECONNECT_MS    5000   // retry WebSocket
#define CONFIG_INTERVAL_MS 300000 // re-download config every 5 min
#define GPIO_DEBOUNCE_MS   50     // debounce window

// ── Global objects ────────────────────────────────────────────────────────────
HardwareSerial modemSerial(1);   // UART1 for A7670E

WiFiClientSecure wifiSecure;  // used only for HTTPClient (config download)
WebsocketsClient ws;
Preferences      prefs;

// ── Runtime state ─────────────────────────────────────────────────────────────
bool  wsConnected     = false;
bool  modemReady      = false;
bool  modemSmsSent    = false;  // prevent duplicate SMS per quench event

// Cached config (NVS-backed)
char  cfgSMSRecipients[512] = "[]";   // JSON array of phone numbers e.g. ["+30691..."]

// Buffers and timers
String       serialBuf   = "";
unsigned long lastSerialMs   = 0;
unsigned long lastStatusMs   = 0;
unsigned long lastWsRetryMs  = 0;
unsigned long lastWifiMs     = 0;
unsigned long lastConfigMs   = 0;

// GPIO state (last confirmed stable value)
int  stableAlarm1 = -1, stableAlarm2 = -1, stableQuench = -1;
int  readingAlarm1, readingAlarm2, readingQuench;  // raw readings
unsigned long changeAlarm1Ms = 0, changeAlarm2Ms = 0, changeQuenchMs = 0;

// ── Debug serial (UART2, optional — connect USB-TTL to GPIO16/17 for debug) ──
#define DBG   Serial2
#define DBG_BAUD 115200
#define DBG_RX_PIN 16
#define DBG_TX_PIN 17
#define LOG(...)  DBG.printf(__VA_ARGS__)

// ── Modem: power on ───────────────────────────────────────────────────────────
void modemPowerOn() {
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(5000);                         // wait for modem to boot
}

// ── Modem: send AT command, wait for expected response ───────────────────────
bool atCmd(const char *cmd, const char *expect = "OK", unsigned long timeoutMs = 3000) {
  while (modemSerial.available()) modemSerial.read();  // flush
  modemSerial.println(cmd);
  unsigned long t = millis();
  String resp = "";
  while (millis() - t < timeoutMs) {
    if (modemSerial.available()) {
      resp += (char)modemSerial.read();
      if (resp.indexOf(expect) >= 0) return true;
      if (resp.indexOf("ERROR") >= 0) { LOG("[AT] ERROR on: %s\n", cmd); return false; }
    }
  }
  LOG("[AT] Timeout: %s\n", cmd);
  return false;
}

// ── Modem: send SMS ───────────────────────────────────────────────────────────
bool modemInitSMS() {
  if (!modemReady) {
    modemSerial.begin(115200, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
    modemPowerOn();
    if (!atCmd("AT", "OK", 5000)) { LOG("[MODEM] Not responding\n"); return false; }
    atCmd("ATE0");               // echo off
    atCmd("AT+CMEE=2");          // verbose errors
    modemReady = true;
  }
  return atCmd("AT+CMGF=1");    // set text mode
}

void sendSMSToAll(const char *message) {
  if (!modemInitSMS()) {
    LOG("[SMS] Modem init failed, cannot send\n");
    return;
  }

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, cfgSMSRecipients) != DeserializationError::Ok) return;
  JsonArray arr = doc.as<JsonArray>();

  for (JsonVariant v : arr) {
    const char *num = v.as<const char *>();
    if (!num || strlen(num) == 0) continue;
    LOG("[SMS] Sending to %s\n", num);

    // Flush modem receive buffer
    while (modemSerial.available()) modemSerial.read();

    String cmdStr = "AT+CMGS=\"";
    cmdStr += num;
    cmdStr += "\"";
    modemSerial.println(cmdStr);

    // Wait for ">" prompt
    unsigned long t = millis();
    String resp = "";
    bool gotPrompt = false;
    while (millis() - t < 10000) {
      if (modemSerial.available()) {
        resp += (char)modemSerial.read();
        if (resp.indexOf('>') >= 0) { gotPrompt = true; break; }
        if (resp.indexOf("ERROR") >= 0) break;
      }
    }
    if (!gotPrompt) { LOG("[SMS] No prompt for %s\n", num); continue; }

    modemSerial.print(message);
    modemSerial.write(0x1A);  // Ctrl-Z to send

    // Wait for +CMGS: or OK
    t = millis(); resp = "";
    while (millis() - t < 30000) {
      if (modemSerial.available()) {
        resp += (char)modemSerial.read();
        if (resp.indexOf("+CMGS:") >= 0 || resp.indexOf("OK") >= 0) {
          LOG("[SMS] Sent to %s\n", num);
          break;
        }
        if (resp.indexOf("ERROR") >= 0) {
          LOG("[SMS] Failed to %s\n", num);
          break;
        }
      }
    }
    delay(500);
  }
}

// ── NVS helpers ───────────────────────────────────────────────────────────────
void loadNVS() {
  prefs.begin("mri", true);
  prefs.getString("smsrc", cfgSMSRecipients, sizeof(cfgSMSRecipients));
  prefs.end();
}

void saveNVS() {
  prefs.begin("mri", false);
  prefs.putString("smsrc", cfgSMSRecipients);
  prefs.end();
}

// ── Config from server ────────────────────────────────────────────────────────
void downloadConfig() {
  if (WiFi.status() != WL_CONNECTED) return;

  String url = String(SERVER_BASE_URL) + "/api/device/config?secret=" DEVICE_SECRET;
  HTTPClient http;
  wifiSecure.setInsecure();
  http.begin(wifiSecure, url);
  int code = http.GET();
  if (code != 200) { LOG("[CFG] HTTP %d\n", code); http.end(); return; }

  String body = http.getString();
  http.end();

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    LOG("[CFG] JSON parse error\n"); return;
  }

  // sms_recipients comes as a JSON array — serialize back to string for NVS
  if (doc.containsKey("sms_recipients")) {
    String smsJson;
    serializeJson(doc["sms_recipients"], smsJson);
    strlcpy(cfgSMSRecipients, smsJson.c_str(), sizeof(cfgSMSRecipients));
    saveNVS();
  }
  LOG("[CFG] Updated — SMS recipients: %s\n", cfgSMSRecipients);
}

// ── WiFi connect ──────────────────────────────────────────────────────────────
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  LOG("[NET] Connecting to %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 20000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    LOG("[NET] WiFi OK  IP=%s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  LOG("[NET] WiFi failed\n");
  return false;
}

// ── WebSocket helpers ─────────────────────────────────────────────────────────
void onWSMessage(WebsocketsMessage msg) {
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, msg.data()) != DeserializationError::Ok) return;

  if (strcmp(doc["type"] | "", "command") == 0) {
    // Forward command text to MRI machine on UART0
    Serial.print(doc["cmd"].as<const char *>());
  }
}

void onWSEvent(WebsocketsEvent event, String /*data*/) {
  if (event == WebsocketsEvent::ConnectionOpened) {
    wsConnected = true;
    LOG("[WS] Connected\n");
  } else if (event == WebsocketsEvent::ConnectionClosed) {
    wsConnected = false;
    LOG("[WS] Disconnected\n");
  } else if (event == WebsocketsEvent::GotPing) {
    ws.pong();
  }
}

bool connectWS() {
  // ArduinoWebsockets handles TLS internally on ESP32 (uses WiFiClientSecure
  // with setInsecure() internally when connecting to wss://)
  ws.onMessage(onWSMessage);
  ws.onEvent(onWSEvent);
  bool ok = ws.connect("wss://" SERVER_HOST "/ws?secret=" DEVICE_SECRET);
  wsConnected = ok;
  if (!ok) LOG("[WS] Connect failed\n");
  return ok;
}

// ── JSON send helpers ─────────────────────────────────────────────────────────
void wsSend(JsonDocument &doc) {
  if (!wsConnected) return;
  String out;
  serializeJson(doc, out);
  ws.send(out);
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
  int rssi  = WiFi.RSSI();

  StaticJsonDocument<128> doc;
  doc["type"]        = "status";
  doc["battery_mv"]  = batMV;
  doc["signal_rssi"] = rssi;
  doc["on_mains"]    = (batMV > 4100);
  wsSend(doc);
}

// ── GPIO debounce & event ─────────────────────────────────────────────────────
void checkGPIO() {
  unsigned long now = millis();
  int a1 = digitalRead(GPIO_ALARM_1);
  int a2 = digitalRead(GPIO_ALARM_2);
  int q  = digitalRead(GPIO_QUENCH);

  // Track when each reading changed from stable value
  auto track = [&](int cur, int &stable, unsigned long &changedMs) {
    if (cur != stable) {
      if (changedMs == 0) changedMs = now;
    } else {
      changedMs = 0;
    }
  };
  track(a1, stableAlarm1, changeAlarm1Ms);
  track(a2, stableAlarm2, changeAlarm2Ms);
  track(q,  stableQuench, changeQuenchMs);

  // Commit stable changes after debounce
  bool changed = false;
  auto commit = [&](int cur, int &stable, unsigned long &changedMs) {
    if (changedMs > 0 && now - changedMs >= GPIO_DEBOUNCE_MS) {
      stable    = cur;
      changedMs = 0;
      changed   = true;
    }
  };
  commit(a1, stableAlarm1, changeAlarm1Ms);
  commit(a2, stableAlarm2, changeAlarm2Ms);
  commit(q,  stableQuench, changeQuenchMs);

  if (!changed) return;

  // Send WS update with confirmed stable values
  sendGPIOUpdate(stableAlarm1, stableAlarm2, stableQuench);

  // ── Quench: CRITICAL — SMS immediately ─────────────────────────────────────
  if (stableQuench == HIGH && !modemSmsSent) {
    modemSmsSent = true;   // prevent repeated SMS for same event
    LOG("[ALERT] *** QUENCH DETECTED — sending SMS ***\n");
    sendSMSToAll("QUENCH DETECTED on MRI magnet! Immediate action required.");
  }
  if (stableQuench == LOW) {
    modemSmsSent = false;  // quench cleared — allow next SMS
  }

  // Alarm 1: INPUT_PULLUP, LOW = active
  if (stableAlarm1 == LOW)  LOG("[ALERT] Alarm 1 active (X119 PIN1)\n");
  // Alarm 2: no pullup, HIGH = active (depending on wiring — adjust if needed)
  if (stableAlarm2 == HIGH) LOG("[ALERT] Alarm 2 active (X119 PIN2)\n");
}

// ── MRI serial buffer flush ───────────────────────────────────────────────────
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
  if (serialBuf.length() > 0 && wsConnected &&
      millis() - lastSerialMs >= SERIAL_FLUSH_MS) {
    lastSerialMs = millis();
    sendSerialChunk(serialBuf);
    serialBuf = "";
  }
}

// ── SMS when WiFi is down and alarms are active ───────────────────────────────
void checkSMSFallback() {
  if (WiFi.status() == WL_CONNECTED) return;  // WiFi up — no SMS needed

  // If any alarm is active and we haven't sent SMS yet, send now
  if ((stableAlarm1 == LOW || stableAlarm2 == HIGH || stableQuench == HIGH)
      && !modemSmsSent) {
    modemSmsSent = true;
    LOG("[SMS] WiFi down + alarm active — sending SMS\n");
    sendSMSToAll("MRI Alarm active! WiFi monitor offline. Check device immediately.");
  }
  if (stableAlarm1 == HIGH && stableAlarm2 == LOW && stableQuench == LOW) {
    modemSmsSent = false;  // all clear — reset for next event
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  // Debug UART2 (optional — connect USB-TTL to GPIO16/17)
  DBG.begin(DBG_BAUD, SERIAL_8N1, DBG_RX_PIN, DBG_TX_PIN);
  LOG("\n[BOOT] MRI Monitor LilyGO A7670E\n");

  // UART0 — MRI RS-232 @ 9600 baud.
  // On LilyGO (Espressif core) Serial is HardwareSerial → 4-arg begin assigns pins.
  // GPIO3=RX (from MRI TX), GPIO1=TX (to MRI RX).
  Serial.begin(9600, SERIAL_8N1, 3, 1);  // requires esp32:esp32 core, NOT arduino:esp32

  // GPIO setup
  pinMode(GPIO_ALARM_1, INPUT_PULLUP);
  pinMode(GPIO_ALARM_2, INPUT);
  pinMode(GPIO_QUENCH,  INPUT);
  analogSetAttenuation(ADC_11db);   // full-scale 3.3 V for GPIO36

  // Read initial GPIO states (avoid false-positive on boot)
  stableAlarm1 = digitalRead(GPIO_ALARM_1);
  stableAlarm2 = digitalRead(GPIO_ALARM_2);
  stableQuench = digitalRead(GPIO_QUENCH);

  // NVS — load cached SMS recipients
  loadNVS();
  LOG("[CFG] SMS recipients (cached): %s\n", cfgSMSRecipients);

  // Network
  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    downloadConfig();
    lastConfigMs = millis();
    connectWS();
    lastWsRetryMs = millis();
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // ── WebSocket poll ──────────────────────────────────────────────────────────
  if (wsConnected) {
    ws.poll();
  }

  // ── WiFi reconnect ───────────────────────────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED && now - lastWifiMs >= WIFI_RECONNECT_MS) {
    lastWifiMs = now;
    wsConnected = false;
    connectWiFi();
  }

  // ── WebSocket reconnect ──────────────────────────────────────────────────────
  if (!wsConnected && WiFi.status() == WL_CONNECTED
      && now - lastWsRetryMs >= WS_RECONNECT_MS) {
    lastWsRetryMs = now;
    connectWS();
  }

  // ── Config refresh ───────────────────────────────────────────────────────────
  if (WiFi.status() == WL_CONNECTED && now - lastConfigMs >= CONFIG_INTERVAL_MS) {
    lastConfigMs = now;
    downloadConfig();
  }

  // ── MRI serial data ──────────────────────────────────────────────────────────
  checkSerial();

  // ── GPIO monitoring + alert logic ────────────────────────────────────────────
  checkGPIO();

  // ── SMS fallback when WiFi is down ───────────────────────────────────────────
  checkSMSFallback();

  // ── Periodic device status ───────────────────────────────────────────────────
  if (wsConnected && now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    sendDeviceStatus();
  }
}
