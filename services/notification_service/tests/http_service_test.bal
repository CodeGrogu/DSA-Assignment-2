import ballerina/test;

@test:Config {}
function testSplitPipeBasic() {
    string[] parts = splitPipe("2026-01-01T00:00:00Z | cust-42 | PUSH | SENT | abc-123");
    test:assertEquals(parts.length(), 5);
    test:assertEquals(parts[1], "cust-42");
    test:assertEquals(parts[2], "PUSH");
    test:assertEquals(parts[3], "SENT");
}

@test:Config {}
function testSplitPipeHandlesWhitespace() {
    string[] parts = splitPipe("a|b|c");
    test:assertEquals(parts[0], "a");
    test:assertEquals(parts[1], "b");
    test:assertEquals(parts[2], "c");
}
