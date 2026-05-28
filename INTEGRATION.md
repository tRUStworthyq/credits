# Интеграция через Kafka

## Обзор

Внешние системы отправляют события об изменении клиентов, сделок и риск-профилей в три Kafka-топика. `deal-service` подписан на все три, обрабатывает события и сохраняет данные в PostgreSQL. После каждой обработки (успешной или нет) публикуется результат в отдельный топик.

---

## Топики

Три входящих топика и один исходящий:

| Топик                  | Партиций | Назначение                          |
|------------------------|----------|-------------------------------------|
| `client-events`        | 3        | CRUD-события клиентов               |
| `deal-events`          | 3        | CRUD-события сделок                 |
| `risk-events`          | 3        | CRUD-события риск-профилей          |
| `entity-event-results` | 1        | Результат обработки каждого события |

---

## Форматы сообщений

Все сообщения — JSON. Ключ сообщения (Kafka record key) — идентификатор сущности (строка).

### `client-events`

**Ключ:** `id` клиента

```json
{
  "action": "CREATE",
  "id": "client-001",
  "fullName": "Иванов Иван Иванович",
  "inn": "123456789012"
}
```

| Поле       | Тип    | Описание                                            |
|------------|--------|-----------------------------------------------------|
| `action`   | enum   | `CREATE` / `UPDATE` / `DELETE`                      |
| `id`       | string | Уникальный идентификатор клиента во внешней системе |
| `fullName` | string | Полное имя, до 255 символов                         |
| `inn`      | string | ИНН: 10 или 12 цифр                                 |

---

### `deal-events`

**Ключ:** `dealNumber`

```json
{
  "action": "CREATE",
  "clientId": "client-001",
  "dealNumber": "D-2024-0001",
  "loanAmountRub": 1500000.00,
  "interestRate": 12.50,
  "issueDate": "2024-03-15",
  "loanTermMonths": 36,
  "repaymentMethod": "Аннуитетный"
}
```

| Поле              | Тип     | Описание                                      |
|-------------------|---------|-----------------------------------------------|
| `action`          | enum    | `CREATE` / `UPDATE` / `DELETE`                |
| `clientId`        | string  | `id` клиента-владельца (должен существовать)  |
| `dealNumber`      | string  | Уникальный номер сделки, до 50 символов       |
| `loanAmountRub`   | decimal | Сумма кредита в рублях                        |
| `interestRate`    | decimal | Процентная ставка (например, `12.50`)         |
| `issueDate`       | string  | Дата выдачи в формате `yyyy-MM-dd` (ISO-8601) |
| `loanTermMonths`  | integer | Срок кредита в месяцах                        |
| `repaymentMethod` | string  | `"Аннуитетный"` или `"Дифференцированный"`    |

> При `DELETE` достаточно передать только `action` и `dealNumber` — остальные поля игнорируются.

---

### `risk-events`

**Ключ:** `inn`

```json
{
  "action": "CREATE",
  "inn": "123456789012",
  "creditHistory": "Хорошая"
}
```

| Поле            | Тип    | Описание                       |
|-----------------|--------|--------------------------------|
| `action`        | enum   | `CREATE` / `UPDATE` / `DELETE` |
| `inn`           | string | ИНН клиента: 10 или 12 цифр    |
| `creditHistory` | string | `"Хорошая"` или `"Плохая"`     |

> При `DELETE` достаточно передать только `action` и `inn`.

---

### `entity-event-results` (ответы)

```json
{
  "entityType": "DEAL",
  "action": "CREATE",
  "entityId": "D-2024-0001",
  "success": true,
  "errorMessage": null
}
```

```json
{
  "entityType": "CLIENT",
  "action": "DELETE",
  "entityId": "client-001",
  "success": false,
  "errorMessage": "Client not found: client-001"
}
```

| Поле           | Тип     | Описание                                       |
|----------------|---------|------------------------------------------------|
| `entityType`   | string  | `"CLIENT"` / `"DEAL"` / `"RISK"`              |
| `action`       | enum    | Действие из исходного события                  |
| `entityId`     | string  | Идентификатор сущности (id / dealNumber / inn) |
| `success`      | boolean | `true` — обработано успешно                    |
| `errorMessage` | string  | Сообщение об ошибке, `null` при успехе         |

---

## Критически важный порядок событий

### CLIENT должен существовать до DEAL

Сделка ссылается на клиента через внешний ключ (`client_deals.client_id`). Если событие `DEAL CREATE` придёт раньше, чем `CLIENT CREATE`, транзакция откатится с ошибкой FK violation, и в `entity-event-results` придёт `success: false`.

Внешняя система **обязана** гарантировать, что клиент создан до отправки его сделок.

### RISK не зависит от порядка

Риск-профиль не связан FK с таблицей `clients` — их связывает только одинаковый `inn`. Событие `RISK CREATE` можно отправлять в любом порядке относительно `CLIENT CREATE`.

---

## Каскадные эффекты

### DELETE CLIENT

При удалении клиента сервис предварительно удаляет все его сделки. Это три операции в одной транзакции: удаление записей из `deals`, удаление строк из `client_deals`, удаление самого клиента.

Риск-профиль при этом **не удаляется** — если нужна полная очистка, отправьте отдельное событие `RISK DELETE` с ИНН клиента.

### UPDATE CLIENT с изменением ИНН

Если в событии `CLIENT UPDATE` пришёл новый `inn`, отличный от текущего, сервис переносит риск-профиль: удаляет запись со старым ИНН и создаёт новую с новым ИНН, сохраняя прежнее значение `creditHistory`. Всё в рамках одной транзакции.

### DELETE DEAL

Удаляются только сама сделка и её запись в `client_deals`. Клиент и риск-профиль не затрагиваются.

---

## Поведение при ошибках

Исключение при обработке события не останавливает консьюмер — следующие сообщения продолжают обрабатываться. Каждое событие оборачивается в try/catch: при ошибке публикуется `success: false` в `entity-event-results`. Частичных сохранений нет — каждая операция выполняется в одной транзакции.

---

## Mock Producer (для тестирования)

Отдельный сервис для ручной отправки событий. Запускается локально и подключается к Kafka на `localhost:29092`.

**Swagger UI:** http://localhost:8088/swagger-ui.html

| Метод | URL                  | Описание                       |
|-------|----------------------|--------------------------------|
| POST  | `/api/mock/clients`  | Отправить событие клиента      |
| POST  | `/api/mock/deals`    | Отправить событие сделки       |
| POST  | `/api/mock/risks`    | Отправить событие риск-профиля |

**Пример: создание клиента и его сделки**

```bash
# 1. Сначала клиент
curl -X POST http://localhost:8088/api/mock/clients \
  -H "Content-Type: application/json" \
  -d '{"action":"CREATE","id":"client-001","fullName":"Иванов Иван","inn":"123456789012"}'

# 2. Затем сделка
curl -X POST http://localhost:8088/api/mock/deals \
  -H "Content-Type: application/json" \
  -d '{"action":"CREATE","clientId":"client-001","dealNumber":"D-2024-001","loanAmountRub":500000.00,"interestRate":12.5,"issueDate":"2024-03-01","loanTermMonths":24,"repaymentMethod":"Аннуитетный"}'
```

**Запуск:**
```bash
cd mock-producer
./mvnw -s settings.xml spring-boot:run
```

Mock Producer не входит в `docker-compose.yml` и предназначен только для локальной разработки.

---

---

## Transaction Service (потоковая обработка платежей)

### Обзор

`transaction-service` реализует потоковую обработку платёжных транзакций на базе Kafka Streams (Event Sourcing). Каждая транзакция обрабатывается атомарно: сервис проверяет текущий баланс пользователя и либо принимает, либо отклоняет операцию. Результат каждой транзакции (ACCEPTED/REJECTED) публикуется в единый топик.

### Топики

| Топик                  | Партиций | Направление | Назначение                                 |
|------------------------|----------|-------------|--------------------------------------------|
| `transaction-events`   | 3        | Вход        | Входящие платёжные события от клиентов     |
| `transaction-results`  | 3        | Выход       | Результат каждой транзакции с итоговым балансом |

### Формат входящего события (`transaction-events`)

**Ключ:** `userId`

```json
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-003",
  "amount": 1500.00,
  "type": "CREDIT",
  "source": "MOBILE_APP",
  "timestamp": 1748342400000
}
```

| Поле            | Тип        | Описание                                            |
|-----------------|------------|-----------------------------------------------------|
| `transactionId` | string     | UUID транзакции                                     |
| `userId`        | string     | Идентификатор пользователя (`user-001` … `user-020`) |
| `amount`        | decimal    | Сумма операции, всегда положительная                 |
| `type`          | enum       | `DEBIT` (+, пополнение) / `CREDIT` (−, списание)    |
| `source`        | enum       | `WEBSITE` / `MOBILE_APP` / `OFFICE`                 |
| `timestamp`     | long       | Unix timestamp в миллисекундах                      |

### Формат результата (`transaction-results`)

**Ключ:** `userId`

```json
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-003",
  "amount": 1500.00,
  "type": "CREDIT",
  "source": "MOBILE_APP",
  "status": "REJECTED",
  "rejectionReason": "INSUFFICIENT_FUNDS",
  "balanceAfter": 320.50,
  "timestamp": 1748342400000
}
```

| Поле              | Тип     | ACCEPTED          | REJECTED                  |
|-------------------|---------|-------------------|---------------------------|
| `status`          | enum    | `ACCEPTED`        | `REJECTED`                |
| `rejectionReason` | string  | `null`            | `"INSUFFICIENT_FUNDS"`    |
| `balanceAfter`    | decimal | Новый баланс      | Текущий баланс (не изменился) |

### Бизнес-правила

- Баланс пользователя не может уйти в минус — CREDIT, приводящий к отрицательному балансу, отклоняется.
- Начальный баланс каждого нового пользователя равен 0.
- Состояние хранится в RocksDB State Store внутри Kafka Streams (два хранилища: `user-balance-store` и `transaction-results-store`).

### REST API (через API Gateway на порту 8085)

| Метод | URL                                             | Описание                                            |
|-------|-------------------------------------------------|-----------------------------------------------------|
| GET   | `/api/transactions?page=0&size=10`              | Все транзакции с статусом, отсортированные по времени |
| GET   | `/api/transactions/balances?page=0&size=10`     | Текущий баланс каждого пользователя                 |

**Пример ответа `GET /api/transactions`:**
```json
{
  "content": [
    {
      "transactionId": "550e8400-...",
      "userId": "user-003",
      "amount": 1500.00,
      "type": "CREDIT",
      "source": "MOBILE_APP",
      "status": "REJECTED",
      "rejectionReason": "INSUFFICIENT_FUNDS",
      "balanceAfter": 320.50,
      "timestamp": 1748342400000
    }
  ],
  "page": 0,
  "size": 10,
  "totalElements": 42
}
```

### Генерация тестовых транзакций (mock-producer)

Mock Producer (порт 8088) запускает генерацию случайных транзакций с регулируемой скоростью.

| Метод | URL                                          | Описание                                   |
|-------|----------------------------------------------|--------------------------------------------|
| POST  | `/api/mock/transactions/start?rate=5`        | Запустить генерацию, 5 сообщений в секунду |
| POST  | `/api/mock/transactions/stop`                | Остановить генерацию                       |

Параметр `rate`: от 1 до 100 сообщений/с (по умолчанию 1).

```bash
# Запустить генерацию на 10 msg/s
curl -X POST "http://localhost:8088/api/mock/transactions/start?rate=10"

# Остановить
curl -X POST "http://localhost:8088/api/mock/transactions/stop"

# Проверить результаты
curl "http://localhost:8085/api/transactions?page=0&size=5"
```

### Конфигурация Kafka (transaction-service)

```yaml
app:
  kafka:
    transaction-events-topic: transaction-events
    transaction-results-topic: transaction-results

spring:
  kafka:
    bootstrap-servers: localhost:29092   # kafka:9092 в Docker
    streams:
      application-id: transaction-processor
      properties:
        processing.guarantee: at_least_once
        auto.offset.reset: latest
```

Kafka Streams application-id: `transaction-processor`

---

## Конфигурация Kafka (deal-service)

```yaml
app:
  kafka:
    bootstrap-servers: localhost:9092    # kafka:9092 в Docker
    client-events-topic: client-events
    deal-events-topic: deal-events
    risk-events-topic: risk-events
    event-results-topic: entity-event-results
    request-topic: risk-requests         # request-reply с risk-service
    reply-topic: risk-responses
    reply-timeout-ms: 10000
```

Consumer group для entity-событий: `deal-entity-events-group`
