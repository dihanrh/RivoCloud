package analytics

import "testing"

func TestPublisher_ZeroValuePublishIsANoop(t *testing.T) {
	var p *Publisher
	p.Publish(Event{ZoneID: "zone-1"}) // must not panic
}

func TestPublisher_PublishWithNoConnectionIsANoop(t *testing.T) {
	p := &Publisher{}
	p.Publish(Event{ZoneID: "zone-1"}) // must not panic
}

func TestConnect_UnreachableServerStillReturnsAUsablePublisher(t *testing.T) {
	// Nothing listens on port 1: with RetryOnFailedConnect the client must
	// keep retrying in the background rather than failing Connect outright.
	p, err := Connect("nats://127.0.0.1:1")
	if err != nil {
		t.Fatalf("expected no error for an unreachable server (retry happens in the background), got %v", err)
	}
	if p == nil || p.nc == nil {
		t.Fatal("expected a publisher backed by a (reconnecting) NATS client")
	}
	defer p.nc.Close()

	if p.nc.IsConnected() {
		t.Fatal("expected the client to not be connected to an unreachable server")
	}
	p.Publish(Event{ZoneID: "zone-1"}) // must not panic or block while reconnecting
}
