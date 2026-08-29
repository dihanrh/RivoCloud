package cacherules

import "testing"

func TestMatch_GlobPattern(t *testing.T) {
	rules := []Rule{{Pattern: "/assets/*", PatternType: "glob", Priority: 0}}
	rule, ok := Match(rules, "/assets/app.js")
	if !ok || rule.Pattern != "/assets/*" {
		t.Fatalf("expected a match, got %+v ok=%v", rule, ok)
	}
}

func TestMatch_ExactPattern(t *testing.T) {
	rules := []Rule{{Pattern: "/exact/path", PatternType: "exact", Priority: 0}}
	if _, ok := Match(rules, "/exact/path/extra"); ok {
		t.Fatal("expected an exact pattern type to require a full literal match, not a prefix")
	}
	if _, ok := Match(rules, "/exact/path"); !ok {
		t.Fatal("expected an exact pattern type to match the identical path")
	}
}

func TestMatch_RegexPattern(t *testing.T) {
	rules := []Rule{{Pattern: `^/api/v[0-9]+/.*$`, PatternType: "regex", Priority: 0}}
	if _, ok := Match(rules, "/api/v2/users"); !ok {
		t.Fatal("expected the regex pattern to match")
	}
	if _, ok := Match(rules, "/other"); ok {
		t.Fatal("expected the regex pattern to reject a non-matching path")
	}
}

func TestMatch_InvalidRegexNeverMatches(t *testing.T) {
	rules := []Rule{{Pattern: "([", PatternType: "regex", Priority: 0}}
	if _, ok := Match(rules, "anything"); ok {
		t.Fatal("expected an unparseable regex to simply never match, not panic")
	}
}

func TestMatch_FirstRuleInOrderWins(t *testing.T) {
	rules := SortByPriorityDesc([]Rule{
		{Pattern: "/assets/*", PatternType: "glob", Priority: 1},
		{Pattern: "/assets/*.js", PatternType: "glob", Priority: 10},
	})
	rule, ok := Match(rules, "/assets/app.js")
	if !ok || rule.Priority != 10 {
		t.Fatalf("expected the higher-priority, more specific rule to win, got %+v", rule)
	}
}

func TestMatch_NoRuleMatches(t *testing.T) {
	rules := []Rule{{Pattern: "/only-this", PatternType: "exact", Priority: 0}}
	if _, ok := Match(rules, "/something-else"); ok {
		t.Fatal("expected no match")
	}
}

func TestSortByPriorityDesc(t *testing.T) {
	sorted := SortByPriorityDesc([]Rule{
		{Pattern: "a", Priority: 1},
		{Pattern: "b", Priority: 10},
		{Pattern: "c", Priority: 5},
	})
	if sorted[0].Pattern != "b" || sorted[1].Pattern != "c" || sorted[2].Pattern != "a" {
		t.Fatalf("expected descending priority order, got %+v", sorted)
	}
}
