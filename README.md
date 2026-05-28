# Мониторинг кредитных сделок

Веб-система для оперативного получения информации по кредитным договорам: остаток на заданную дату, остаток через год, мультивалютный пересчёт по актуальному курсу ЦБ РФ. Доступ ограничен авторизованными сотрудниками через SSO.

---

## Стек технологий

| Категория | Технологии |
|---|---|
| **Язык / Runtime** | Java 21 |
| **Фреймворк** | Spring Boot 4.0.5, Spring Cloud 2025.1.1 |
| **Сборка** | Maven |
| **Аутентификация** | Keycloak (OAuth2 / OpenID Connect) |
| **База данных** | PostgreSQL 15 |
| **Брокер сообщений** | Apache Kafka 7.4.4 + Zookeeper, Kafka Streams (transaction-service) |
| **Межсервисный RPC** | REST (HTTP), gRPC (currency-service) |
| **Кэширование** | Caffeine (курсы валют, TTL 10–15 мин) |
| **Внешняя интеграция** | API ЦБ РФ — `cbr-xml-daily.ru/daily_json.js` |
| **Метрики** | Prometheus + Grafana |
| **Трассировка** | Jaeger (OpenTelemetry / Zipkin) |
| **Логирование** | ELK (Elasticsearch 8.11 + Logstash + Kibana) |
| **Нагрузочное тестирование** | k6 |

---

## Требования к ресурсам

| Параметр | Минимум | Рекомендуется |
|---|---------|---------------|
| **RAM** | 10 ГБ   | 16 ГБ         |
| **CPU** | 4 ядра  | 6 ядер        |
| **Диск** | 10 ГБ   | 20 ГБ         |
| **Docker** | 24.x+   | —             |
| **Docker Compose** | v2.x+   | —             |

> Суммарный лимит памяти контейнеров — около 12.7 ГБ, но в реальности при достаточно низком RPS требуется около 9 ГБ. На хосте необходимо оставить запас для ОС и Docker Engine.

---

## Порты

### Приложение

| Контейнер | Порт на хосте | Описание |
|---|---|---|
| `api-gateway` | **8085** | Точка входа; OAuth2-защита всех маршрутов |
| `deal-service` | **8083** | Сервис кредитных сделок; расчёт остатков |
| `client-service` | **8081** | Сервис клиентов / заёмщиков |
| `risk-service` | **8082** | Сервис оценки рисков (потребитель Kafka) |
| `currency-service` (HTTP) | **8086** | Интеграция с ЦБ РФ, REST-эндпоинты |
| `currency-service` (gRPC) | **9091** | gRPC-сервер для межсервисных вызовов |
| `transaction-service` | **8087** | Обработка и валидация финансовых транзакций; Kafka Streams + RocksDB |

### transaction-service

`transaction-service` — сервис обработки финансовых транзакций, построенный на **Kafka Streams**. Ключевые особенности:

- **Потребляет** топик `transaction-events` (события с полями: `transactionId`, `userId`, `amount`, `type: DEBIT/CREDIT`)
- **Публикует** в топик `transaction-results` результаты с итогом `ACCEPTED` / `REJECTED` (причина: `INSUFFICIENT_FUNDS`)
- **Не использует PostgreSQL** — состояние (баланс пользователей, архив результатов) хранится в персистентных RocksDB-хранилищах Kafka Streams (`user-balance-store`, `transaction-results-store`)
- Предоставляет REST API для просмотра результатов транзакций и балансов пользователей:
  - `GET /api/transactions` — постраничный список результатов (сортировка по дате или сумме)
  - `GET /api/transactions/balances` — текущие балансы пользователей

### Инфраструктура

| Контейнер | Порт на хосте | Описание |
|---|---|---|
| `keycloak` | **8080** | Консоль администратора и OIDC-эндпоинты |
| `kafka` | **9092** | Kafka Broker |
| `zookeeper` | **2181** | Kafka координация |
| `kafka-ui` | **8095** | Web UI для Kafka |
| `elasticsearch` | **9200** | REST API |
| `logstash` | **5000** | Приём логов (TCP/UDP) |
| `kibana` | **5601** | Просмотр логов |
| `prometheus` | **9090** | Сбор метрик |
| `grafana` | **3000** | Дашборды (логин задаётся в `.env`) |
| `jaeger` | **16686** | UI распределённой трассировки |

---

## Инструкция по запуску

### 1. Клонирование репозитория

```bash
git clone --recurse-submodules https://github.com/tRUStworthyq/credits.git
cd credits
```

Если репозиторий уже склонирован без субмодулей:

```bash
git submodule update --init --recursive
```

### 2. Настройка переменных окружения

Скопируйте файл примера и задайте свои значения:

```bash
cp .env.example .env
```

Отредактируйте `.env` — замените пароли и секреты на собственные. Файл `.env` прочитывается Docker Compose автоматически и **не попадает в репозиторий** (включён в `.gitignore`).

| Переменная | Описание |
|---|---|
| `POSTGRES_DEAL_USER` / `POSTGRES_DEAL_PASSWORD` | Учётные данные БД сделок |
| `POSTGRES_KEYCLOAK_USER` / `POSTGRES_KEYCLOAK_PASSWORD` | Учётные данные БД Keycloak |
| `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD` | Администратор Keycloak |
| `KC_CLIENT_SECRET` | OAuth2-секрет клиента `api-gateway` (должен совпадать с `keycloak/realm-export.json`) |
| `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` | Администратор Grafana |

### 3. Запуск стека

```bash
docker compose up -d
```

Первый запуск занимает 3–5 минут — скачиваются образы и инициализируются БД. Следить за готовностью:

```bash
docker compose ps
```

Все сервисы приложения должны перейти в статус `healthy` или `running`.

### 4. Первоначальная настройка Keycloak

Realm `sber-realm` импортируется автоматически при старте контейнера.

1. Открыть [http://localhost:8080](http://localhost:8080) → войти с данными `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD` из `.env`
2. Убедиться, что в левом верхнем углу выбран realm **sber-realm**
3. Создать пользователя: **Users → Add user** — заполнить Email, First name, Last name, Phone; включить **Email verified**
4. Перейти на вкладку **Credentials → Set password** — задать пароль, выключить **Temporary**

### 5. Открыть приложение

[http://localhost:8085](http://localhost:8085) — вход выполняется через Keycloak SSO.

### 6. Остановка

```bash
docker compose down
```

Для полного сброса (включая тома с данными):

```bash
docker compose down -v
```

---

## Нагрузочное тестирование

Подробная инструкция по запуску нагрузочных тестов (k6, 300 RPS, SLA-пороги): [LOAD_TESTS.md](LOAD_TESTS.md)

---

## Лицензия

[LICENSE](LICENSE.txt)