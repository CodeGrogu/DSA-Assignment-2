FROM eclipse-temurin:21-jre-jammy

WORKDIR /app
RUN groupadd -g 10001 ballerina && useradd -u 10001 -g ballerina -m -s /bin/bash ballerina

COPY services/payment_service/target/bin/payment_service.jar /app/service.jar
COPY services/payment_service/Config.toml /app/Config.toml

EXPOSE 9094
USER 10001
ENTRYPOINT ["java", "-jar", "/app/service.jar"]
