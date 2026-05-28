package ru.sber.mockproducer.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import ru.sber.messages.ClientEvent;
import ru.sber.messages.DealEvent;
import ru.sber.messages.RiskEvent;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class EventPublisherService {

    private final KafkaTemplate<String, Object> kafkaTemplate;

    @Value("${app.kafka.client-events-topic}")
    private String clientEventsTopic;

    @Value("${app.kafka.deal-events-topic}")
    private String dealEventsTopic;

    @Value("${app.kafka.risk-events-topic}")
    private String riskEventsTopic;

    public void publishClientEvent(ClientEvent event) {
        String key = event.id() != null ? event.id() : UUID.randomUUID().toString();
        kafkaTemplate.send(clientEventsTopic, key, event);
    }

    public void publishDealEvent(DealEvent event) {
        String key = event.dealNumber() != null ? event.dealNumber() : UUID.randomUUID().toString();
        kafkaTemplate.send(dealEventsTopic, key, event);
    }

    public void publishRiskEvent(RiskEvent event) {
        String key = event.inn() != null ? event.inn() : UUID.randomUUID().toString();
        kafkaTemplate.send(riskEventsTopic, key, event);
    }
}
