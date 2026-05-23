# Нагрузочное тестирование — POST /api/deals/calculate

## Описание

Скрипт `calculate-load-test.js` проводит нагрузочное тестирование эндпоинта расчёта кредитной сделки с целевой нагрузкой **300 RPS** в течение **60 секунд**.

Инструмент: [k6](https://k6.io) — опенсорсный инструмент для нагрузочного тестирования.

---

## Требования

- Docker Desktop (запущен)
- [k6](https://k6.io/docs/get-started/installation/) установлен локально
- Запущен полный стек через `docker compose up -d`

---

## Шаг 1 — Установить k6

**Windows (winget):**
```powershell
winget install k6 --source winget
```

**Windows (Chocolatey):**
```powershell
choco install k6
```

**macOS:**
```bash
brew install k6
```

**Linux (Debian/Ubuntu):**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
     --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
     | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

Проверка установки:
```bash
k6 version
```

---

## Шаг 2 — Запустить инфраструктуру

Из корня репозитория:
```bash
docker compose up -d
```

Дождаться, пока все сервисы поднимутся (обычно 1–2 минуты). Проверить состояние:
```bash
docker compose ps
```

Все сервисы должны быть в статусе `healthy` или `running`.

---

## Шаг 3 — Создать тестового пользователя в Keycloak

> api-gateway защищён через OAuth2 Authorization Code Flow.  
> Скрипт логинится от имени реального пользователя Keycloak.

1. Открыть Keycloak Admin Console: [http://localhost:8080](http://localhost:8080)
2. Войти: `admin` / `admin`
3. В левом верхнем углу выбрать realm **sber-realm**
4. В меню слева: **Users → Add user**
5. Заполнить обязательные поля:
   - **Email** — например, `test@test.com`
   - **First name** — любое
   - **Last name** — любое
   - **Phone** — любое (например, `+70000000000`)
   - **Email verified** — включить
6. Нажать **Create**
7. Перейти на вкладку **Credentials → Set password**
8. Задать пароль, **Temporary — выключить**
9. Нажать **Save password**

---

## Шаг 4 — Запустить нагрузочный тест

Из корня репозитория:

```bash
k6 run \
  -e KC_USER=loadtest@test.com \
  -e KC_PASS=yourpassword \
  load-tests/calculate-load-test.js
```

### Дополнительные параметры

| Переменная     | По умолчанию            | Описание                                |
|----------------|-------------------------|-----------------------------------------|
| `KC_USER`      | —                       | Email пользователя Keycloak (обязателен)|
| `KC_PASS`      | —                       | Пароль пользователя (обязателен)        |
| `BASE_URL`     | `http://localhost:8085` | URL api-gateway                         |
| `KEYCLOAK_URL` | `http://localhost:8080` | URL Keycloak                            |
| `TARGET_RPS`   | `300`                   | Целевой RPS                             |
| `DURATION`     | `60s`                   | Длительность теста                      |

Пример с нестандартными параметрами:
```bash
k6 run \
  -e KC_USER=loadtest@test.com \
  -e KC_PASS=yourpassword \
  -e TARGET_RPS=100 \
  -e DURATION=120s \
  load-tests/calculate-load-test.js
```

---

## Пороговые значения (SLA)

Тест считается **пройденным**, если выполнены все условия:

| Метрика                                      | Порог    |
|----------------------------------------------|----------|
| Latency p(95) эндпоинта `/calculate`         | < 2 000 мс |
| Latency p(99) эндпоинта `/calculate`         | < 5 000 мс |
| Доля ошибок (`errors`)                       | < 5%     |
| Доля HTTP-ошибок (`http_req_failed`)         | < 5%     |

Если хотя бы один порог нарушен, k6 завершается с **exit code 99**.

---

## Пример вывода k6

```
✓ status 200
✓ body present
✓ latency <5s

checks.........................: 99.87% ✓ 17978 ✗ 23
data_received..................: 12 MB   198 kB/s
data_sent......................: 2.8 MB  46 kB/s
errors.........................: 0.13%  ✓ 0    ✗ 23
http_req_duration..............: avg=312ms min=89ms med=287ms max=4.1s p(90)=521ms p(95)=712ms
  { name:calculate }..........: avg=312ms min=89ms med=287ms max=4.1s p(90)=521ms p(95)=712ms
http_req_failed................: 0.13%  ✓ 23   ✗ 17955
http_reqs......................: 17978  299.6/s
vus............................: 94     min=1   max=150
```

---

## Наблюдаемость во время теста

| Инструмент     | URL                                                                   | Что смотреть                                                        |
|----------------|-----------------------------------------------------------------------|---------------------------------------------------------------------|
| **Grafana**    | [http://localhost:3000](http://localhost:3000) (admin / admin)        | Метрика `deal_calculate_seconds` — p95, p99, rate                   |
| **Prometheus** | [http://localhost:9090](http://localhost:9090)                        | `histogram_quantile(0.95, rate(deal_calculate_seconds_bucket[1m]))` |
| **Jaeger**     | [http://localhost:16686](http://localhost:16686)                      | Трейсы запросов: deal-service → risk-service (Kafka), currency-service (gRPC) |
| **Kafka UI**   | [http://localhost:8095](http://localhost:8095)                        | Лаг консьюмер-группы `risk-request-group`                           |

> Kafka UI доступен только при запуске через `docker-compose-test.yml`.

---

## Возможные ошибки и решения

**`Missing credentials`**  
Не переданы переменные `KC_USER` или `KC_PASS`. Добавить `-e KC_USER=... -e KC_PASS=...` в команду запуска.

**`Expected 302 redirect from gateway, got 000`**  
api-gateway не запущен или недоступен. Проверить: `docker compose ps api-gateway`.

**`Keycloak login page returned 404 / 502`**  
Keycloak ещё не поднялся. Подождать и проверить: `docker compose ps keycloak`.

**`Login failed`**  
Пользователь с таким email/паролем не найден в realm `sber-realm`. Проверить Keycloak Admin → Users.

**`WARN: Insufficient VUs`**  
k6 не может достичь целевого RPS — backend не справляется с нагрузкой. Посмотреть трейсы в Jaeger для диагностики узкого места.
