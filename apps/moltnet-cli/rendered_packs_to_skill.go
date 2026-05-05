package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// skillBundle is the in-memory representation of an AgentSkills SKILL.md file.
//
// The body is a verbatim copy of the rendered pack content. The frontmatter
// carries identity fields under the `moltnet:` namespace so re-runs can
// detect updates without an external sidecar.
type skillBundle struct {
	slug             string
	description      string
	body             string
	renderedPackID   uuid.UUID
	renderedPackCid  string
	sourcePackID     uuid.UUID
	bundledAt        time.Time
}

// renderSkillMarkdown serialises a skillBundle into AgentSkills SKILL.md form.
//
// Frontmatter shape:
//
//	---
//	name: <slug>
//	description: <one-liner>
//	moltnet:
//	  rendered_pack_id: <uuid>
//	  rendered_pack_cid: <cid>
//	  source_pack_id: <uuid>
//	  bundled_at: <RFC3339>
//	---
//
// The blank line between frontmatter and body is required by the
// AgentSkills spec.
func renderSkillMarkdown(b skillBundle) string {
	var sb strings.Builder
	sb.WriteString("---\n")
	fmt.Fprintf(&sb, "name: %s\n", b.slug)
	fmt.Fprintf(&sb, "description: %s\n", b.description)
	sb.WriteString("moltnet:\n")
	fmt.Fprintf(&sb, "  rendered_pack_id: %s\n", b.renderedPackID)
	fmt.Fprintf(&sb, "  rendered_pack_cid: %s\n", b.renderedPackCid)
	fmt.Fprintf(&sb, "  source_pack_id: %s\n", b.sourcePackID)
	fmt.Fprintf(&sb, "  bundled_at: %s\n", b.bundledAt.UTC().Format(time.RFC3339))
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
// `moltnet.rendered_pack_id` value, if present. Returns uuid.Nil and a nil
// error when the file exists but lacks the moltnet block — that's a
// user-edited skill we shouldn't clobber unless the caller decides to.
//
// Minimal parser: scans the YAML frontmatter line-by-line for the literal
// `  rendered_pack_id: <uuid>` form. Avoids pulling in a YAML dependency
// for a single field.
var renderedPackIDLine = regexp.MustCompile(`(?m)^\s+rendered_pack_id:\s*([0-9a-fA-F-]{36})\s*$`)

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

	bundle := skillBundle{
		slug:            slugForRenderedPack(pack.ID),
		description:     fmt.Sprintf("Rendered pack %s (method: %s)", pack.ID, pack.RenderMethod),
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

	fmt.Fprintf(os.Stderr, "Wrote %s\n", path)
	return nil
}
