#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ========== ΡΥΘΜΙΣΕΙΣ ==========
const char* wsHost = "magnets.karnagio.org";
const int   wsPort = 443;

struct WiFiNetwork { const char* ssid; const char* password; };
WiFiNetwork networks[] = {
  { "YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD" }
};
const int networkCount = sizeof(networks) / sizeof(networks[0]);
// ================================

WebSocketsClient webSocket;
String serialBuffer = "";
bool wsConnected = false;
unsigned long lastSendMs = 0;

void sendJson(const char* type, const char* key, const char* value) {
  DynamicJsonDocument doc(1024);
  doc["type"] = type;
  doc["mac"]  = WiFi.macAddress();
  if (key && value) doc[key] = value;
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(out);
}

void flushBuffer() {
  if (serialBuffer.length() == 0 || !wsConnected) { serialBuffer = ""; return; }
  sendJson("serial_data", "data", serialBuffer.c_str());
  serialBuffer = "";
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      sendJson("esp_hello", nullptr, nullptr);
      break;
    case WStype_DISCONNECTED:
      wsConnected = false;
      break;
    case WStype_TEXT: {
      StaticJsonDocument<128> doc;
      deserializeJson(doc, payload, length);
      if (doc["type"] == "command") {
        String cmd = doc["cmd"].as<String>();
        Serial.print(cmd);
      }
      break;
    }
  }
}

void connectWiFi() {
  WiFi.disconnect();
  while (true) {
    for (int i = 0; i < networkCount; i++) {
      WiFi.begin(networks[i].ssid, networks[i].password);
      for (int t = 0; t < 20; t++) {
        if (WiFi.status() == WL_CONNECTED) return;
        delay(500);
      }
      WiFi.disconnect();
      delay(500);
    }
  }
}

void setup() {
  Serial.begin(9600);
  WiFi.mode(WIFI_STA);
  connectWiFi();
  webSocket.beginSSL(wsHost, wsPort, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(25000, 5000, 2);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    wsConnected = false;
    connectWiFi();
  }
  webSocket.loop();

  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\0') serialBuffer += c;  // pass everything, including ESC and CR
    if (serialBuffer.length() >= 400) {
      lastSendMs = millis();
      flushBuffer();
    }
  }

  unsigned long now = millis();
  if (serialBuffer.length() > 0 && wsConnected && (now - lastSendMs) >= 100) {
    lastSendMs = now;
    flushBuffer();
  }
}
