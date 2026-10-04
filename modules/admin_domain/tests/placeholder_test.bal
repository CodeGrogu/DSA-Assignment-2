import ballerina/test;

// TODO: real tests come in a later commit. This one just makes
// sure `bal test` has something to run so CI stays green.
@test:Config {}
function placeholderTest() {
    test:assertTrue(true);
}
