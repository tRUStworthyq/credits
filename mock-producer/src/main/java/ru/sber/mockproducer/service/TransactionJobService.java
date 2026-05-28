package ru.sber.mockproducer.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import ru.sber.mockproducer.model.TransactionEvent;
import ru.sber.mockproducer.model.TransactionSource;
import ru.sber.mockproducer.model.TransactionType;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.IntStream;

@Service
@RequiredArgsConstructor
public class TransactionJobService {

    private final KafkaTemplate<String, Object> kafkaTemplate;

    @Value("${app.kafka.transaction-events-topic}")
    private String topic;

    private static final List<String> USER_IDS = IntStream.rangeClosed(1, 20)
            .mapToObj(i -> "user-%03d".formatted(i))
            .toList();

    private static final TransactionSource[] SOURCES = TransactionSource.values();
    private static final TransactionType[] TYPES = TransactionType.values();

    private final Random random = new Random();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile ScheduledExecutorService scheduler;

    public synchronized String start(int messagesPerSecond) {
        if (running.get()) {
            return "Already running";
        }
        long periodMs = 1_000L / messagesPerSecond;
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(this::sendTransaction, 0, periodMs, TimeUnit.MILLISECONDS);
        running.set(true);
        return "Started at %d msg/s".formatted(messagesPerSecond);
    }

    public synchronized String stop() {
        if (!running.get()) {
            return "Not running";
        }
        scheduler.shutdownNow();
        running.set(false);
        return "Stopped";
    }

    public boolean isRunning() {
        return running.get();
    }

    private void sendTransaction() {
        String userId = USER_IDS.get(random.nextInt(USER_IDS.size()));
        BigDecimal amount = BigDecimal.valueOf(random.nextDouble() * 5_000)
                .setScale(2, RoundingMode.HALF_UP);
        TransactionType type = TYPES[random.nextInt(TYPES.length)];
        TransactionSource source = SOURCES[random.nextInt(SOURCES.length)];

        TransactionEvent event = new TransactionEvent(
                UUID.randomUUID().toString(),
                userId,
                amount,
                type,
                source,
                System.currentTimeMillis()
        );
        kafkaTemplate.send(topic, userId, event);
    }
}
