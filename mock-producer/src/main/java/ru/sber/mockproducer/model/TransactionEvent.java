package ru.sber.mockproducer.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TransactionEvent {
    private String transactionId;
    private String userId;
    private BigDecimal amount;
    private TransactionType type;
    private TransactionSource source;
    private long timestamp;
}
