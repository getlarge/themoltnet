package main

import (
	"context"
	"fmt"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// --- Relation type/status parsers ---

// parseRelationType converts a string to the API RelationType enum.
func parseRelationType(s string) (moltnetapi.RelationType, error) {
	switch s {
	case "supersedes":
		return moltnetapi.RelationTypeSupersedes, nil
	case "elaborates":
		return moltnetapi.RelationTypeElaborates, nil
	case "contradicts":
		return moltnetapi.RelationTypeContradicts, nil
	case "supports":
		return moltnetapi.RelationTypeSupports, nil
	case "caused_by":
		return moltnetapi.RelationTypeCausedBy, nil
	case "references":
		return moltnetapi.RelationTypeReferences, nil
	default:
		return "", fmt.Errorf("unknown relation type %q (valid: supersedes, elaborates, contradicts, supports, caused_by, references)", s)
	}
}

// parseRelationStatus converts a string to the API RelationStatus enum.
func parseRelationStatus(s string) (moltnetapi.RelationStatus, error) {
	switch s {
	case "proposed":
		return moltnetapi.RelationStatusProposed, nil
	case "accepted":
		return moltnetapi.RelationStatusAccepted, nil
	case "rejected":
		return moltnetapi.RelationStatusRejected, nil
	default:
		return "", fmt.Errorf("unknown relation status %q (valid: proposed, accepted, rejected)", s)
	}
}

// parseCreateRelationStatus converts a string to CreateEntryRelationReqStatus.
func parseCreateRelationStatus(s string) (moltnetapi.CreateEntryRelationReqStatus, error) {
	switch s {
	case "proposed":
		return moltnetapi.CreateEntryRelationReqStatusProposed, nil
	case "accepted":
		return moltnetapi.CreateEntryRelationReqStatusAccepted, nil
	default:
		return "", fmt.Errorf("unknown create-relation status %q (valid: proposed, accepted)", s)
	}
}

// --- Business logic functions ---

// runRelationsCreateCmd creates an entry relation.
func runRelationsCreateCmd(apiURL, credPath, entryID, targetID, relation, status string) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}
	targetUUID, err := uuid.Parse(targetID)
	if err != nil {
		return fmt.Errorf("invalid target ID %q: %w", targetID, err)
	}
	relType, err := parseRelationType(relation)
	if err != nil {
		return err
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	req := &moltnetapi.CreateEntryRelationReq{
		Relation: relType,
		TargetId: targetUUID,
	}
	if status != "" {
		st, err := parseCreateRelationStatus(status)
		if err != nil {
			return err
		}
		req.Status = moltnetapi.OptCreateEntryRelationReqStatus{Value: st, Set: true}
	}

	res, err := client.CreateEntryRelation(context.Background(), req, moltnetapi.CreateEntryRelationParams{EntryId: entryUUID})
	if err != nil {
		return fmt.Errorf("relations create: %w", err)
	}
	result, ok := res.(*moltnetapi.CreateEntryRelationOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(result)
}

// runRelationsListCmd lists entry relations.
func runRelationsListCmd(apiURL, credPath, entryID, relation, status, direction string, limit int) error {
	entryUUID, err := uuid.Parse(entryID)
	if err != nil {
		return fmt.Errorf("invalid entry ID %q: %w", entryID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	params := moltnetapi.ListEntryRelationsParams{EntryId: entryUUID}
	if relation != "" {
		rt, err := parseRelationType(relation)
		if err != nil {
			return err
		}
		params.Relation = moltnetapi.OptRelationType{Value: rt, Set: true}
	}
	if status != "" {
		st, err := parseRelationStatus(status)
		if err != nil {
			return err
		}
		params.Status = moltnetapi.OptRelationStatus{Value: st, Set: true}
	}
	if direction != "" {
		params.Direction = moltnetapi.OptListEntryRelationsDirection{
			Value: moltnetapi.ListEntryRelationsDirection(direction),
			Set:   true,
		}
	}
	if limit > 0 {
		params.Limit = moltnetapi.OptInt{Value: limit, Set: true}
	}

	res, err := client.ListEntryRelations(context.Background(), params)
	if err != nil {
		return fmt.Errorf("relations list: %w", err)
	}
	list, ok := res.(*moltnetapi.EntryRelationList)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(list)
}

// runRelationsUpdateCmd updates a relation's status.
func runRelationsUpdateCmd(apiURL, credPath, relationID, status string) error {
	relUUID, err := uuid.Parse(relationID)
	if err != nil {
		return fmt.Errorf("invalid relation ID %q: %w", relationID, err)
	}
	st, err := parseRelationStatus(status)
	if err != nil {
		return err
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	req := &moltnetapi.UpdateEntryRelationStatusReq{Status: st}
	res, err := client.UpdateEntryRelationStatus(context.Background(), req, moltnetapi.UpdateEntryRelationStatusParams{ID: relUUID})
	if err != nil {
		return fmt.Errorf("relations update: %w", err)
	}
	result, ok := res.(*moltnetapi.EntryRelation)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(result)
}

// runRelationsDeleteCmd deletes a relation by ID.
func runRelationsDeleteCmd(apiURL, credPath, relationID string) error {
	relUUID, err := uuid.Parse(relationID)
	if err != nil {
		return fmt.Errorf("invalid relation ID %q: %w", relationID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	if _, err := client.DeleteEntryRelation(context.Background(), moltnetapi.DeleteEntryRelationParams{ID: relUUID}); err != nil {
		return fmt.Errorf("relations delete: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Relation %s deleted.\n", relationID)
	return nil
}
