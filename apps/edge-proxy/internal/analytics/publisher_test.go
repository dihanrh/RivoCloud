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
