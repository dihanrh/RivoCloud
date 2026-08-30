package globmatch

import "testing"

func TestMatch_ExactLiteral(t *testing.T) {
	if !Match("/logo.png", "/logo.png") {
		t.Fatal("expected an exact literal to match itself")
	}
	if Match("/logo.png", "/other.png") {
		t.Fatal("expected different literals to not match")
	}
}

func TestMatch_TrailingStarMatchesAnySuffix(t *testing.T) {
	if !Match("/assets/*", "/assets/app.js") {
		t.Fatal("expected /assets/* to match /assets/app.js")
	}
	if !Match("/assets/*", "/assets/vendor/bundle.js") {
		t.Fatal("expected /assets/* to match across a nested slash")
	}
	if Match("/assets/*", "/other/app.js") {
		t.Fatal("expected /assets/* to not match a different prefix")
	}
}

func TestMatch_SuffixStarMatchesFileExtension(t *testing.T) {
	if !Match("/assets/*.js", "/assets/app.js") {
		t.Fatal("expected /assets/*.js to match /assets/app.js")
	}
	if Match("/assets/*.js", "/assets/app.css") {
		t.Fatal("expected /assets/*.js to not match a .css file")
	}
}

func TestMatch_BareStarMatchesEverything(t *testing.T) {
	if !Match("*", "/anything/at/all") {
		t.Fatal("expected a bare * to match any path (whole-zone purge)")
	}
}

func TestMatch_MultipleStars(t *testing.T) {
	if !Match("/api/*/detail*", "/api/users/detail-42") {
		t.Fatal("expected multiple wildcards to all be honored")
	}
	if Match("/api/*/detail*", "/api/users/summary-42") {
		t.Fatal("expected the literal 'detail' segment to still be required")
	}
}

func TestMatch_NoWildcardRequiresExactMatch(t *testing.T) {
	if Match("/logo.png", "/logo.png?v=2") {
		t.Fatal("expected a pattern with no wildcard to require an exact match")
	}
}
