const cfg = rs.conf();

if (cfg.members[0].host !== "mongodb:27017") {
    cfg.members[0].host = "mongodb:27017";
    rs.reconfig(cfg);
    print("Replica set reconfigured to mongodb:27017");
} else {
    print("Replica set already uses mongodb:27017");
}
