#include <SoftwareSerial.h>

SoftwareSerial esp(2, 3); // RX: 2, TX: 3

const String SSID = "3F_302";
const String PASS = "0424719222!!";
const String SERVER_IP = "192.168.0.51";
const String PORT = "8000";

// 이 보드가 담당하는 화분 번호
const int PLANT_ID = 1;

// 토양 수분 센서
const int SENSOR_PIN = A0;

// 캘리브레이션 값 (이 보드에 연결된 센서 기준으로 실측한 값)
const int DRY_VALUE = 1023;
const int WET_VALUE = 280;

int readMoisturePercent(int pin) {
  long sum = 0;
  for (int i = 0; i < 5; i++) {
    sum += analogRead(pin);
    delay(20);
  }
  int raw = sum / 5;

  int percent = map(raw, DRY_VALUE, WET_VALUE, 0, 100);
  return constrain(percent, 0, 100);
}

void setup() {
  Serial.begin(9600);
  esp.begin(9600);

  delay(3000); // 부팅 대기

  sendCmd("AT+CWMODE=1", 1000);

  // Wi-Fi 접속
  Serial.println("Wi-Fi 연결 시도 중...");
  sendCmd("AT+CWJAP=\"" + SSID + "\",\"" + PASS + "\"", 8000);

  // 단일 연결 모드 설정
  sendCmd("AT+CIPMUX=0", 1000);
}

void loop() {
  int moisture = readMoisturePercent(SENSOR_PIN);
  sendMoisture(PLANT_ID, moisture);
  delay(5000);
}

void sendMoisture(int plantId, int moisture) {
  // 1. 이전 연결 정리
  sendCmd("AT+CIPCLOSE", 1000);

  // 2. TCP 연결 시도
  esp.print("AT+CIPSTART=\"TCP\",\"");
  esp.print(SERVER_IP);
  esp.print("\",");
  esp.println(PORT);
  delay(3000); // 서버와 TCP 연결 수립될 때까지 확실히 대기

  // 3. body와 요청 문자열을 char 배열로 구성
  char body[32];
  snprintf(body, sizeof(body), "{\"moisture\":%d}", moisture);

  char httpReq[256];
  snprintf(httpReq, sizeof(httpReq),
    "POST /api/plants/%d/moisture HTTP/1.1\r\n"
    "Host: %s:%s\r\n"
    "Content-Type: application/json\r\n"
    "Content-Length: %d\r\n\r\n"
    "%s",
    plantId, SERVER_IP.c_str(), PORT.c_str(), (int)strlen(body), body
  );

  // 4. 데이터 길이 전달 후 전송
  esp.print("AT+CIPSEND=");
  esp.println(strlen(httpReq));
  delay(1500); // CIPSEND 응답 대기

  esp.print(httpReq);
  delay(1500); // 데이터 송신 완료 대기

  // 5. 연결 종료
  sendCmd("AT+CIPCLOSE", 1000);

  Serial.print("[화분 ");
  Serial.print(plantId);
  Serial.print("] 수분값 ");
  Serial.print(moisture);
  Serial.println("% 전송 시도 완료!");
}

void sendCmd(String cmd, int timeout) {
  esp.println(cmd);
  long int time = millis();
  while ((time + timeout) > millis()) {
    while (esp.available()) {
      Serial.write(esp.read());
    }
  }
  delay(300);
}
