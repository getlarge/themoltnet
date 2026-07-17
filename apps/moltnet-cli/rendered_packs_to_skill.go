package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// skillBundle is the in-memory representation of an AgentSkills SKILL.md file.
//
// The body is a verbatim copy of the rendered pack content. The frontmatter
// carries identity fields under the Agent Skills `metadata` field so re-runs
// can detect updates without an external sidecar.
type skillBundle struct {
	slug            string
	description     string
	body            string
	renderedPackID  uuid.UUID
	renderedPackCid string
	sourcePackID    uuid.UUID
	bundledAt       time.Time
}

// renderSkillMarkdown serialises a skillBundle into AgentSkills SKILL.md form.
//
// Frontmatter shape:
//
//	---
//	name: <slug>
//	description: <one-liner>
//	metadata:
//	  moltnet.rendered_pack_id: <uuid>
//	  moltnet.rendered_pack_cid: <cid>
//	  moltnet.source_pack_id: <uuid>
//	  moltnet.bundled_at: <RFC3339>
//	---
//
// The blank line between frontmatter and body is required by the
// AgentSkills spec.
func renderSkillMarkdown(b skillBundle) string {
	var sb strings.Builder
	sb.WriteString("---\n")
	fmt.Fprintf(&sb, "name: %s\n", b.slug)
	fmt.Fprintf(&sb, "description: %s\n", strconv.Quote(b.description))
	sb.WriteString("metadata:\n")
	fmt.Fprintf(&sb, "  moltnet.rendered_pack_id: %s\n", strconv.Quote(b.renderedPackID.String()))
	fmt.Fprintf(&sb, "  moltnet.rendered_pack_cid: %s\n", strconv.Quote(b.renderedPackCid))
	fmt.Fprintf(&sb, "  moltnet.source_pack_id: %s\n", strconv.Quote(b.sourcePackID.String()))
	fmt.Fprintf(&sb, "  moltnet.bundled_at: %s\n", strconv.Quote(b.bundledAt.UTC().Format(time.RFC3339)))
	sb.WriteString("---\n\n")
	sb.WriteString(b.body)
	if !strings.HasSuffix(b.body, "\n") {
		sb.WriteString("\n")
	}
	return sb.String()
}

// slugForRenderedPack derives a stable, filesystem-safe slug from a rendered
// pack. Format: `rendered-pack-<first-8-of-uuid>`.
//
// Stable across re-renders because it derives from the rendered pack UUID,
// which the server keeps constant when content changes are rejected by the
// uniqueness constraint, and assigns a fresh one when a new rendered pack
// supersedes a source pack.
func slugForRenderedPack(id uuid.UUID) string {
	return "rendered-pack-" + id.String()[:8]
}

// extractRenderedPackIDFromSkill parses a SKILL.md and returns the
// `metadata.moltnet.rendered_pack_id` value, if present. It also accepts the
// legacy top-level `moltnet.rendered_pack_id` shape so existing bundles remain
// protected from slug collisions during migration. Returns uuid.Nil and a nil
// error when the file lacks either field — that's a user-edited skill we
// shouldn't clobber unless the caller decides to.
//
// Minimal parser: scans the YAML frontmatter line-by-line for the literal
// `  moltnet.rendered_pack_id: <uuid>` and legacy
// `  rendered_pack_id: <uuid>` forms. Avoids pulling in a YAML dependency for
// a single field.
var renderedPackIDLine = regexp.MustCompile(`(?m)^\s+(?:moltnet\.)?rendered_pack_id:\s*"?([0-9a-fA-F-]{36})"?\s*$`)

const maxSkillDescriptionLength = 1024

func validateSkillBundle(b skillBundle) error {
	if b.description == "" {
		return fmt.Errorf("skill description must not be empty")
	}
	if length := utf8.RuneCountInString(b.description); length > maxSkillDescriptionLength {
		return fmt.Errorf(
			"skill description exceeds Agent Skills %d-character limit (%d characters)",
			maxSkillDescriptionLength,
			length,
		)
	}
	return nil
}

func extractRenderedPackIDFromSkill(content string) (uuid.UUID, error) {
	if !strings.HasPrefix(content, "---\n") {
		return uuid.Nil, nil
	}
	end := strings.Index(content[4:], "\n---")
	if end < 0 {
		return uuid.Nil, nil
	}
	frontmatter := content[4 : 4+end]
	m := renderedPackIDLine.FindStringSubmatch(frontmatter)
	if m == nil {
		return uuid.Nil, nil
	}
	return uuid.Parse(m[1])
}

// writeSkillBundle writes a skill bundle to <outDir>/<slug>/SKILL.md.
//
// Idempotency: if the target SKILL.md already exists and its
// rendered_pack_id matches the new bundle's, the file is overwritten with
// fresh content + bundled_at. If the existing rendered_pack_id is different,
// the function returns an error — the caller has hit a slug collision
// against a different rendered pack.
func writeSkillBundle(outDir string, b skillBundle) (string, error) {
	b.description = strings.TrimSpace(b.description)
	if err := validateSkillBundle(b); err != nil {
		return "", err
	}

	skillDir := filepath.Join(outDir, b.slug)
	skillPath := filepath.Join(skillDir, "SKILL.md")

	if existing, err := os.ReadFile(skillPath); err == nil {
		existingID, parseErr := extractRenderedPackIDFromSkill(string(existing))
		if parseErr != nil {
			return "", fmt.Errorf("parse existing SKILL.md frontmatter at %s: %w", skillPath, parseErr)
		}
		if existingID != uuid.Nil && existingID != b.renderedPackID {
			return "", fmt.Errorf(
				"slug collision: %s already maps to rendered pack %s (refusing to overwrite with %s)",
				skillPath, existingID, b.renderedPackID,
			)
		}
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("stat %s: %w", skillPath, err)
	}

	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", skillDir, err)
	}
	if err := os.WriteFile(skillPath, []byte(renderSkillMarkdown(b)), 0o644); err != nil {
		return "", fmt.Errorf("write %s: %w", skillPath, err)
	}
	return skillPath, nil
}

// runRenderedPackToSkill fetches a rendered pack by ID and writes a
// SKILL.md bundle to outDir.
func runRenderedPackToSkill(apiURL, credPath, id, outDir string) error {
	renderedPackID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid --id %q: %w", id, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	res, err := client.GetRenderedPackById(
		context.Background(),
		moltnetapi.GetRenderedPackByIdParams{ID: renderedPackID},
	)
	if err != nil {
		return fmt.Errorf("rendered-pack to-skill: %w", formatTransportError(err))
	}
	pack, ok := res.(*moltnetapi.RenderedPackWithContent)
	if !ok {
		return formatAPIError(res)
	}
	if strings.TrimSpace(pack.Content) == "" {
		return fmt.Errorf("rendered pack %s has empty content", renderedPackID)
	}

	description, isPlaceholder := descriptionForBundle(pack)
	bundle := skillBundle{
		slug:            slugForRenderedPack(pack.ID),
		description:     description,
		body:            pack.Content,
		renderedPackID:  pack.ID,
		renderedPackCid: pack.PackCid,
		sourcePackID:    pack.SourcePackId,
		bundledAt:       time.Now(),
	}

	path, err := writeSkillBundle(outDir, bundle)
	if err != nil {
		return err
	}

	if isPlaceholder {
		fmt.Fprintf(
			os.Stderr,
			"warning: rendered pack %s has no description; SKILL.md uses a placeholder that won't drive activation. Set one with:\n  moltnet rendered-pack update --id %s --description \"Use when ...\"\n",
			pack.ID, pack.ID,
		)
	}
	fmt.Fprintf(os.Stderr, "Wrote %s\n", path)
	return nil
}

// descriptionForBundle returns the SKILL.md description for a rendered pack,
// preferring the server-side `description` sidecar field when set. When the
// server has no description, returns a placeholder string and isPlaceholder=true
// so the caller can warn.
func descriptionForBundle(pack *moltnetapi.RenderedPackWithContent) (string, bool) {
	if !pack.Description.Null && strings.TrimSpace(pack.Description.Value) != "" {
		return pack.Description.Value, false
	}
	return fmt.Sprintf(
		"Rendered pack %s (method: %s) — no description set; run `moltnet rendered-pack update --id %s --description ...`",
		pack.ID, pack.RenderMethod, pack.ID,
	), true
}
