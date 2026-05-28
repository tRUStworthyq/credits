package ru.sber.mockproducer.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import ru.sber.messages.DealEvent;
import ru.sber.mockproducer.service.EventPublisherService;

@RestController
@RequestMapping("/api/mock/deals")
@RequiredArgsConstructor
@Tag(name = "Deal Events", description = "Отправка событий сделок в Kafka")
public class MockDealEventController {

    private final EventPublisherService eventPublisherService;

    @PostMapping
    @Operation(summary = "Отправить событие сделки (CREATE / UPDATE / DELETE)")
    public ResponseEntity<String> send(@RequestBody DealEvent event) {
        eventPublisherService.publishDealEvent(event);
        return ResponseEntity.accepted()
                .body("Deal event sent: action=%s dealNumber=%s".formatted(event.action(), event.dealNumber()));
    }
}
