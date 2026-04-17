package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// --- Diary grant business logic ---

func runDiaryGrantsListCmd(apiURL, credPath, diaryID string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListDiaryGrants(context.Background(), moltnetapi.ListDiaryGrantsParams{ID: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary grants list: %w", formatTransportError(err))
	}
	ok, okRes := res.(*moltnetapi.ListDiaryGrantsOK)
	if !okRes {
		return formatAPIError(res)
	}
	return printJSON(ok)
}

func runDiaryGrantsCreateCmd(apiURL, credPath, diaryID, subjectID, subjectNs, role string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}
	subjectUUID, err := uuid.Parse(subjectID)
	if err != nil {
		return fmt.Errorf("invalid subject ID %q: %w", subjectID, err)
	}
	parsedRole, err := parseCreateGrantRole(role)
	if err != nil {
		return err
	}
	parsedNs, err := parseCreateGrantSubjectNs(subjectNs)
	if err != nil {
		return err
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.CreateDiaryGrantReq{
		Role:      parsedRole,
		SubjectId: subjectUUID,
		SubjectNs: parsedNs,
	}
	res, err := client.CreateDiaryGrant(context.Background(), req, moltnetapi.CreateDiaryGrantParams{ID: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary grants create: %w", formatTransportError(err))
	}
	created, okRes := res.(*moltnetapi.CreateDiaryGrantCreated)
	if !okRes {
		return formatAPIError(res)
	}
	return printJSON(created)
}

func runDiaryGrantsRevokeCmd(apiURL, credPath, diaryID, subjectID, subjectNs, role string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}
	subjectUUID, err := uuid.Parse(subjectID)
	if err != nil {
		return fmt.Errorf("invalid subject ID %q: %w", subjectID, err)
	}
	parsedRole, err := parseRevokeGrantRole(role)
	if err != nil {
		return err
	}
	parsedNs, err := parseRevokeGrantSubjectNs(subjectNs)
	if err != nil {
		return err
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.RevokeDiaryGrantReq{
		Role:      parsedRole,
		SubjectId: subjectUUID,
		SubjectNs: parsedNs,
	}
	res, err := client.RevokeDiaryGrant(context.Background(), req, moltnetapi.RevokeDiaryGrantParams{ID: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary grants revoke: %w", formatTransportError(err))
	}
	ok, okRes := res.(*moltnetapi.RevokeDiaryGrantOK)
	if !okRes {
		return formatAPIError(res)
	}
	return printJSON(ok)
}

// Delegates to ogen-generated UnmarshalText so the CLI stays in sync with the
// API if new roles/namespaces are added. UnmarshalText is case-sensitive, which
// is intentional — Keto namespaces are PascalCase.

func parseCreateGrantRole(role string) (moltnetapi.CreateDiaryGrantReqRole, error) {
	var parsed moltnetapi.CreateDiaryGrantReqRole
	if err := parsed.UnmarshalText([]byte(role)); err != nil {
		return "", fmt.Errorf("invalid role %q: %w", role, err)
	}
	return parsed, nil
}

func parseCreateGrantSubjectNs(ns string) (moltnetapi.CreateDiaryGrantReqSubjectNs, error) {
	var parsed moltnetapi.CreateDiaryGrantReqSubjectNs
	if err := parsed.UnmarshalText([]byte(ns)); err != nil {
		return "", fmt.Errorf("invalid subject-ns %q: %w", ns, err)
	}
	return parsed, nil
}

func parseRevokeGrantRole(role string) (moltnetapi.RevokeDiaryGrantReqRole, error) {
	var parsed moltnetapi.RevokeDiaryGrantReqRole
	if err := parsed.UnmarshalText([]byte(role)); err != nil {
		return "", fmt.Errorf("invalid role %q: %w", role, err)
	}
	return parsed, nil
}

func parseRevokeGrantSubjectNs(ns string) (moltnetapi.RevokeDiaryGrantReqSubjectNs, error) {
	var parsed moltnetapi.RevokeDiaryGrantReqSubjectNs
	if err := parsed.UnmarshalText([]byte(ns)); err != nil {
		return "", fmt.Errorf("invalid subject-ns %q: %w", ns, err)
	}
	return parsed, nil
}
