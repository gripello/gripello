package climbers

import "testing"

func TestShortName(t *testing.T) {
	cases := map[[3]string]string{
		{"anna42", "Anna", "Müller"}: "Anna M.",
		{"anna42", "Anna", ""}:       "Anna",
		{"anna42", "", "Müller"}:     "Müller",
		{"anna42", "", ""}:           "anna42",
		{"x", " Ölaf ", " Østby"}:    "Ölaf Ø.",
	}
	for in, want := range cases {
		if got := ShortName(in[0], in[1], in[2]); got != want {
			t.Errorf("%v: got %q want %q", in, got, want)
		}
	}
	if AvatarURL("u1", "") != "" || AvatarURL("u1", "a.png") != "/api/files/users/u1/a.png?thumb=100x100" {
		t.Fatal("avatar url")
	}
}

func TestFullName(t *testing.T) {
	if FullName("anna42", "Anna", "Müller") != "Anna Müller" || FullName("anna42", "", "") != "anna42" || FullName("x", " Anna ", "") != "Anna" {
		t.Fatal("full name")
	}
}
