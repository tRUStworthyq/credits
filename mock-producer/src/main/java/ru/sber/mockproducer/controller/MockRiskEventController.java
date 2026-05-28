package ru.sber.mockproducer.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import ru.sber.messages.RiskEvent;
import ru.sber.mockproducer.service.EventPublisherService;

@RestController
@RequestMapping("/api/mock/risks")
@RequiredArgsConstructor
@Tag(name = "Risk Events", description = "Отправка событий риск-профилей в Kafka")
public class MockRiskEventController {

    private final EventPublisherService eventPublisherService;

    @PostMapping
    @Operation(summary = "Отправить событие риск-профиля (CREATE / UPDATE / DELETE)")
    public ResponseEntity<String> send(@RequestBody RiskEvent event) {
        eventPublisherService.publishRiskEvent(event);
        return ResponseEntity.accepted()
                .body("Risk event sent: action=%s inn=%s".formatted(event.action(), event.inn()));
    }
}
