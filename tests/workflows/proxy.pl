use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;
$SIG{CHLD} = 'IGNORE';

sub proxy {
    my ($local_port, $remote_host, $remote_port) = @_;
    my $server = IO::Socket::INET->new(
        LocalAddr => '127.0.0.1',
        LocalPort => $local_port,
        Proto     => 'tcp',
        Listen    => 32,
        ReuseAddr => 1,
    ) or die "Cannot listen on $local_port: $!\n";

    while (my $client = $server->accept()) {
        my $pid = fork();
        if (!defined $pid) {
            close $client;
            next;
        }
        if ($pid == 0) {
            close $server;
            my $remote = IO::Socket::INET->new(
                PeerAddr => $remote_host,
                PeerPort => $remote_port,
                Proto    => 'tcp',
                Timeout  => 10,
            );
            if (!$remote) {
                close $client;
                exit 0;
            }
            my $sel = IO::Select->new($client, $remote);
            my $buf;
            while (my @ready = $sel->can_read()) {
                for my $fh (@ready) {
                    my $bytes = sysread($fh, $buf, 8192);
                    if (!defined $bytes || $bytes == 0) {
                        exit 0;
                    }
                    my $dest = ($fh == $client) ? $remote : $client;
                    syswrite($dest, $buf, $bytes);
                }
            }
            exit 0;
        }
        close $client;
    }
}

my $p1 = fork();
if ($p1 == 0) {
    proxy(27017, 'mongodb', 27017);
    exit 0;
}
my $p2 = fork();
if ($p2 == 0) {
    proxy(9092, 'kafka', 9092);
    exit 0;
}
while (1) { sleep 3600; }
