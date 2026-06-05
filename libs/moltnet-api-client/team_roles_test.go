package moltnetapi

import "testing"

func TestListTeamMembersRoleConstantsAreSingular(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		role ListTeamMembersOKItemsItemRole
		want string
	}{
		{
			name: "owner",
			role: ListTeamMembersOKItemsItemRoleOwner,
			want: "owner",
		},
		{
			name: "manager",
			role: ListTeamMembersOKItemsItemRoleManager,
			want: "manager",
		},
		{
			name: "member",
			role: ListTeamMembersOKItemsItemRoleMember,
			want: "member",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.role.MarshalText()
			if err != nil {
				t.Fatalf("marshal role: %v", err)
			}
			if string(got) != tt.want {
				t.Fatalf("role = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestListTeamMembersRoleRejectsPluralRelations(t *testing.T) {
	t.Parallel()

	for _, value := range []string{"owners", "managers", "members"} {
		t.Run(value, func(t *testing.T) {
			var role ListTeamMembersOKItemsItemRole
			if err := role.UnmarshalText([]byte(value)); err == nil {
				t.Fatalf("expected %q to be rejected", value)
			}
		})
	}
}
