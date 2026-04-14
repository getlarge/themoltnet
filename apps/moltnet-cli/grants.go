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
		return fmt.Errorf("diary grants list: %w", err)
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
		return fmt.Errorf("diary grants create: %w", err)
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
		return fmt.Errorf("diary grants revoke: %w", err)
	}
	ok, okRes := res.(*moltnetapi.RevokeDiaryGrantOK)
	if !okRes {
		return formatAPIError(res)
	}
	return printJSON(ok)
}

func parseCreateGrantRole(role string) (moltnetapi.CreateDiaryGrantReqRole, error) {
	switch role {
	case string(moltnetapi.CreateDiaryGrantReqRoleWriter):
		return moltnetapi.CreateDiaryGrantReqRoleWriter, nil
	case string(moltnetapi.CreateDiaryGrantReqRoleManager):
		return moltnetapi.CreateDiaryGrantReqRoleManager, nil
	default:
		return "", fmt.Errorf("invalid role %q: must be writer or manager", role)
	}
}

func parseCreateGrantSubjectNs(ns string) (moltnetapi.CreateDiaryGrantReqSubjectNs, error) {
	switch ns {
	case string(moltnetapi.CreateDiaryGrantReqSubjectNsAgent):
		return moltnetapi.CreateDiaryGrantReqSubjectNsAgent, nil
	case string(moltnetapi.CreateDiaryGrantReqSubjectNsHuman):
		return moltnetapi.CreateDiaryGrantReqSubjectNsHuman, nil
	case string(moltnetapi.CreateDiaryGrantReqSubjectNsGroup):
		return moltnetapi.CreateDiaryGrantReqSubjectNsGroup, nil
	default:
		return "", fmt.Errorf("invalid subject-ns %q: must be Agent, Human, or Group", ns)
	}
}

func parseRevokeGrantRole(role string) (moltnetapi.RevokeDiaryGrantReqRole, error) {
	switch role {
	case string(moltnetapi.RevokeDiaryGrantReqRoleWriter):
		return moltnetapi.RevokeDiaryGrantReqRoleWriter, nil
	case string(moltnetapi.RevokeDiaryGrantReqRoleManager):
		return moltnetapi.RevokeDiaryGrantReqRoleManager, nil
	default:
		return "", fmt.Errorf("invalid role %q: must be writer or manager", role)
	}
}

func parseRevokeGrantSubjectNs(ns string) (moltnetapi.RevokeDiaryGrantReqSubjectNs, error) {
	switch ns {
	case string(moltnetapi.RevokeDiaryGrantReqSubjectNsAgent):
		return moltnetapi.RevokeDiaryGrantReqSubjectNsAgent, nil
	case string(moltnetapi.RevokeDiaryGrantReqSubjectNsHuman):
		return moltnetapi.RevokeDiaryGrantReqSubjectNsHuman, nil
	case string(moltnetapi.RevokeDiaryGrantReqSubjectNsGroup):
		return moltnetapi.RevokeDiaryGrantReqSubjectNsGroup, nil
	default:
		return "", fmt.Errorf("invalid subject-ns %q: must be Agent, Human, or Group", ns)
	}
}
