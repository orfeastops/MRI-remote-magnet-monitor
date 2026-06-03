# LilyGO T-A7670E — Flash Guide

## Before you start

1. Edit `lilygo_a7670e.ino` — change these 3 lines:
   ```cpp
   #define DEVICE_SECRET  "paste-secret-from-server-here"
   #define WIFI_SSID      "your-wifi-name"
   #define WIFI_PASS      "your-wifi-password"
   ```
   Get the device secret from the admin panel:
   **POST /api/v2/company/devices** → response includes `"secret"` (shown once only).

## Arduino IDE setup

### Install the Espressif ESP32 board package
   - File → Preferences → Additional Board Manager URLs, add:
     ```
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
   - Tools → Board → Boards Manager → search "esp32" → install **esp32 by Espressif Systems** ≥ 3.0

### Install required libraries (Tools → Manage Libraries)
   | Library | Author | Version |
   |---|---|---|
   | ArduinoWebsockets | Gil Maimon | ≥ 0.5.4 |
   | ArduinoJson | Benoit Blanchon | ≥ 7.0 |

## Board settings
   - Board: **ESP32 Dev Module** (or LilyGO T-A7670G if listed)
   - Upload Speed: 921600
   - CPU Frequency: 240 MHz
   - Flash Size: 4MB
   - Partition Scheme: Default 4MB with spiffs
   - Port: whichever COM/ttyUSB appears when you plug in the USB-C

## arduino-cli (Linux command line)
```bash
# Install Espressif core
arduino-cli core install esp32:esp32

# Install libraries
arduino-cli lib install "ArduinoWebsockets"
arduino-cli lib install "ArduinoJson"

# Find port
arduino-cli board list

# Compile + upload
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/lilygo_a7670e/
arduino-cli upload  --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 firmware/lilygo_a7670e/
```

## Debug output
Connect a USB-TTL adapter to GPIO16 (RX) and GPIO17 (TX) at 115200 baud.
All `LOG(...)` output goes there. UART0 (GPIO1/3) is reserved for MRI data only.

## Wiring reminder
| LilyGO pin | Connect to |
|---|---|
| GPIO3 (UART0 RX) | MRI RS-232 TX (via TTL adapter) |
| GPIO1 (UART0 TX) | MRI RS-232 RX (via TTL adapter) |
| GPIO32 | X119 PIN1 alarm (INPUT_PULLUP) |
| GPIO34 | X119 PIN2 alarm (INPUT, no pullup) |
| GPIO35 | X119 PIN3 quench CRITICAL (INPUT, no pullup) |
| GPIO36 | Battery voltage divider midpoint |
| GPIO26 | A7670E RX (modem UART) |
| GPIO27 | A7670E TX (modem UART) |
| GPIO4  | A7670E PWRKEY |

## Confirming it works
1. Open debug serial at 115200 baud
2. You should see:
   ```
   [BOOT] MRI Monitor LilyGO A7670E
   [NET] Connecting to <your-ssid>...
   [NET] WiFi OK  IP=192.168.x.x
   [CFG] Updated — SMS recipients: ["+306..."]
   [WS] Connected
   ```
3. In the server-v2 dashboard the device will appear online.
