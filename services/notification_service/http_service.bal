import ballerina/http;
import ballerina/io;
import ballerina/log;
import ballerina/regex;

listener http:Listener httpListener = new (9095);

service /notifications on httpListener {

    resource function get recipient/[string id]() returns json|http:NotFound {
        string[] rows = readAuditRows();
        json[] matching = [];

        foreach string row in rows {
            string[] parts = splitPipe(row);
            if parts.length() >= 5 && parts[1] == id {
                matching.push({
                    sentAt: parts[0],
                    recipientId: parts[1],
                    channel: parts[2],
                    status: parts[3],
                    notificationId: parts[4]
                });
            }
        }

        if matching.length() == 0 {
            return http:NOT_FOUND;
        }
        return matching;
    }
}

function readAuditRows() returns string[] {
    // Try to read the file. If it doesn't exist, just return empty.
    string|error contentOrErr = io:fileReadString(AUDIT_FILE);
    if contentOrErr is error {
        log:printWarn("Audit file not present", path = AUDIT_FILE);
        return [];
    }

    string[] lines = [];
    foreach string line in regex:split(contentOrErr, "\n") {
        string trimmed = line.trim();
        if trimmed != "" {
            lines.push(trimmed);
        }
    }
    return lines;
}

function splitPipe(string line) returns string[] {
    string[] parts = regex:split(line, "\\|");
    string[] out = [];
    foreach string p in parts {
        out.push(p.trim());
    }
    return out;
}
