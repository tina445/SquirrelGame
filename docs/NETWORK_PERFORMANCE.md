# 네트워크 성능 기준

이 문서는 동일한 로컬 production build 조건에서 네트워크 전송 최적화 전후를 비교하기 위한 기준과 재현 절차를 기록한다. 수치는 WebSocket 텍스트 payload 기준이며 TLS·Cloud Run proxy·공개 인터넷 오버헤드는 포함하지 않는다.

## 재현 절차

서버와 부하 도구를 각각 실행한다.

```sh
npm run build
PORT=8080 HOST=127.0.0.1 MATCH_BOTS_ENABLED=false npm start -w server
LOAD_WS_URL=ws://127.0.0.1:8080 LOAD_BOTS=80 LOAD_ROOM_SIZE=8 LOAD_DURATION_MS=30000 npm run load:test
```

부하 도구는 10개의 친구 방을 만들고 방마다 경찰 4명·도둑 4명의 역할 선택, asset 준비, 사용자 준비, 방장 시작을 수행한다. 모든 방이 `PLAYING`에 도달한 뒤 측정을 시작한다. `LOAD_BOTS`는 `LOAD_ROOM_SIZE`로 나누어떨어져야 하며 현재 서버의 4:4 규칙에 따라 `LOAD_ROOM_SIZE=8`만 허용한다. 연결 준비 timeout은 `LOAD_CONNECT_TIMEOUT_MS`로 조정할 수 있다.

출력은 한 줄 JSON이다. 전체와 연결별 snapshot Hz, payload 총량·평균·p95, 수신 간격 평균·p95·최댓값, protocol/server 오류, WebSocket close code와 최종 process 결과를 포함한다.

## 변경 전 기준치

2026-08-25 protocol v11 production build에서 80 clients, 10 rooms × 8 players, 30초간 측정했다. 원본 결과는 구현 세션의 `/tmp/squirrel-network-baseline.json`에 기록했다.

| 지표 | 변경 전 |
| --- | ---: |
| 연결 / 방 | 80 / 10 |
| snapshot 수신률 | 20.033 Hz/client |
| snapshot 수 | 48,080 |
| snapshot payload 총량 | 266,207,249 B |
| snapshot payload 처리율 | 8,873,610 B/s |
| snapshot 평균 / p95 크기 | 5,536.8 B / 5,671 B |
| 수신 간격 평균 / p95 / 최대 | 49.95 / 52.57 / 77.24 ms |
| 서버 수신 / 송신 증가량 | 10,645,154 B / 266,282,121 B |
| room tick p95 최대 | 1.020 ms |
| catch-up / invalid message | 0 / 0 |

메모리는 부하 중 RSS 단일 표본 95,852 KiB였지만 강제 GC와 시계열 표본이 없어 누수 판정 기준으로 사용하지 않는다. 기존 room tick p95도 측정 구간 delta가 아닌 서버의 최근 sliding window 값이다.

## 변경 후 비교

네트워크 리팩토링이 통합된 protocol v12 production build에서 동일하게 80 clients, 10 rooms × 8 players를 30.000476초간 측정했다. 부하 도구 결과는 `PASS`였고 protocol/server 오류 없이 모든 80개 연결이 close code 1000으로 종료됐다.

| 지표 | 변경 전 | 변경 후 | 변화 |
| --- | ---: | ---: | ---: |
| snapshot 수신률 | 20.033 Hz/client | 9.99984 Hz/client | 10Hz publish 목표 충족 |
| snapshot 수 | 48,080 | 24,000 | 약 50% 감소 |
| snapshot payload 총량 | 266,207,249 B | 132,567,896 B | 50.20% 감소 |
| snapshot payload 처리율 | 8,873,610 B/s | 4,418,859.72 B/s | 50.20% 감소 |
| snapshot 평균 / p95 크기 | 5,536.8 B / 5,671 B | 5,523.66 B / 5,736 B | 유사 |
| 수신 간격 평균 / p95 / 최대 | 49.95 / 52.57 / 77.24 ms | 99.9857 / 102.8468 / 125.4536 ms | 10Hz 간격과 일치 |
| room tick p95 최대 | 1.020 ms | 0.131037 ms | 87.15% 감소 |
| catch-up / invalid message | 0 / 0 | 0 / 0 | 회귀 없음 |

중간 `/metrics` 표본에서 각 방의 `snapshotSerializationCount`는 `snapshotPublishCount`와 같아 방당 publish마다 한 번만 직렬화됐다. 직렬화 p95 최댓값은 0.07917ms, send callback p95 최댓값은 4.040762ms였다. `snapshotSupersededCount=0`, 최대 `bufferedAmount=0`으로 나타났는데, 이는 정상적인 로컬 loopback 연결에서 backpressure가 발생하지 않았기 때문이다. 느린 연결의 최신 snapshot 대체와 reliable 메시지 보존 경로는 별도의 fake slow transport 단위 테스트로 검증한다.

Node event-loop delay는 20ms 해상도에서 p95 21.135359ms, 최대 154.271743ms였다. 최댓값에는 80개 연결과 10개 방의 생성·준비·시작 burst가 포함되므로 steady-state tick 지연으로 해석하지 않는다.

동일한 80-client·30초 조건의 두 번째 run도 `PASS`했다. 부하 중과 종료 후 서버 RSS 표본은 108,432 → 108,420 → 108,428KiB, CPU 표본은 8.0% → 8.0% → 6.8%로 지속 증가 추세가 없었고 종료 후 `/health`의 room 수는 0이었다. 다만 짧은 구간의 소수 표본이므로 장기 실행의 메모리 누수 부재까지 보장하지는 않는다.

snapshot 수신률 9.5~10.5Hz, outbound application payload 45% 이상 감소, room tick p95 50ms 미만, catch-up 0, 정확한 10개 8인 방과 오류 없는 종료라는 합격 기준을 모두 충족했다. 총 payload 감소율은 `1 - 132,567,896 / 266,207,249 = 50.2012%`, 초당 payload 감소율은 50.2022%로 계산된다.
