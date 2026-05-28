package ru.sber.mockproducer.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import ru.sber.messages.ClientEvent;
import ru.sber.mockproducer.service.EventPublisherService;

@RestController
@RequestMapping("/api/mock/clients")
@RequiredArgsConstructor
@Tag(name = "Client Events", description = "Отправка событий клиентов в Kafka")
public class MockClientEventController {

    private final EventPublisherService eventPublisherService;

    @PostMapping
    @Operation(summary = "Отправить событие клиента (CREATE / UPDATE / DELETE)")
    public ResponseEntity<String> send(@RequestBody ClientEvent event) {
        eventPublisherService.publishClientEvent(event);
        return ResponseEntity.accepted()
                .body("Client event sent: action=%s id=%s".formatted(event.action(), event.id()));
    }
}
