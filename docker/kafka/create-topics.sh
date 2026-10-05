#!/usr/bin/env bash
# docker/kafka/create-topics.sh
# Idempotent topic provisioning script for Kafka cluster.
# Configures 3 partitions, replication factor 2, and min.insync.replicas=2.

set -euo pipefail

BOOTSTRAP_SERVER="${KAFKA_BOOTSTRAP_SERVER:-kafka:9092}"

echo "Waiting for Kafka cluster (${BOOTSTRAP_SERVER}) to be ready..."
until kafka-topics --bootstrap-server "${BOOTSTRAP_SERVER}" --list > /dev/null 2>&1; do
  sleep 2
done
echo "Kafka cluster is ready!"

TOPICS=(
  "orders.created"
  "orders.events"
  "orders.confirmed"
  "orders.cancelled"
  "orders.preparing"
  "orders.ready"
  "payments.events"
  "payments.completed"
  "payments.failed"
  "payments.refunded"
  "kitchen.events"
  "kitchen.ready"
  "kitchen.rejected"
  "kitchen.orders.ready"
  "delivery.events"
  "delivery.assigned"
  "delivery.completed"
  "delivery.status"
  "notifications.events"
  "dead-letter-queue"
  "orders.events.dlq"
  "orders.created.dlq"
  "orders.confirmed.dlq"
  "payments.events.dlq"
  "kitchen.events.dlq"
  "delivery.events.dlq"
)

# Detect number of available brokers in the cluster
NUM_BROKERS=$(kafka-broker-api-versions --bootstrap-server "${BOOTSTRAP_SERVER}" 2>/dev/null | grep -E 'id: [0-9]+' | wc -l || echo 1)
if [ "${NUM_BROKERS}" -lt 2 ]; then
  REPLICATION_FACTOR=1
  MIN_ISR=1
else
  REPLICATION_FACTOR=2
  MIN_ISR=2
fi

echo "Detected ${NUM_BROKERS} broker(s). Using replication-factor=${REPLICATION_FACTOR}, min.insync.replicas=${MIN_ISR}"

for topic in "${TOPICS[@]}"; do
  echo "Provisioning topic: ${topic}"
  kafka-topics --create --if-not-exists \
    --bootstrap-server "${BOOTSTRAP_SERVER}" \
    --partitions 3 \
    --replication-factor "${REPLICATION_FACTOR}" \
    --config min.insync.replicas="${MIN_ISR}" \
    --config retention.ms=604800000 \
    --config segment.bytes=1073741824 \
    --topic "${topic}"
done

echo "Topic provisioning complete. Current cluster topics:"
kafka-topics --bootstrap-server "${BOOTSTRAP_SERVER}" --list
