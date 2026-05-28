package ru.sber.mockproducer.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.sber.mockproducer.service.TransactionJobService;

@RestController
@RequestMapping("/api/mock/transactions")
@RequiredArgsConstructor
@Tag(name = "Transaction Job", description = "Управление джобой генерации платёжных транзакций")
public class TransactionJobController {

    private final TransactionJobService transactionJobService;

    @PostMapping("/start")
    @Operation(summary = "Запустить джобу с заданной скоростью (msg/s)")
    public ResponseEntity<String> start(
            @RequestParam(defaultValue = "1") int rate
    ) {
        if (rate < 1 || rate > 100) {
            return ResponseEntity.badRequest().body("rate must be between 1 and 100");
        }
        String result = transactionJobService.start(rate);
        return ResponseEntity.accepted().body(result);
    }

    @PostMapping("/stop")
    @Operation(summary = "Остановить джобу")
    public ResponseEntity<String> stop() {
        return ResponseEntity.ok(transactionJobService.stop());
    }
}
