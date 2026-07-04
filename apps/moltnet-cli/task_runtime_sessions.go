package main

import (
	"context"
	"fmt"
	"io"

	"github.com/google/uuid"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

type taskRuntimeSessionGetOpts struct {
	apiURL   string
	credPath string
	taskID   string
	teamID   string
	attemptN int
	out      io.Writer
}

type taskRuntimeSessionUploadOpts struct {
	apiURL                 string
	credPath               string
	taskID                 string
	teamID                 string
	attemptN               int
	sessionKind            string
	file                   string
	parentSessionID        string
	sourceSlotID           string
	sourceRuntimeProfileID string
	out                    io.Writer
}

type taskRuntimeSessionDownloadOpts struct {
	apiURL   string
	credPath string
	taskID   string
	teamID   string
	attemptN int
	outFile  string
	out      io.Writer
}

func runTaskRuntimeSessionGetCmd(opts taskRuntimeSessionGetOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskRuntimeSessionGetWithClient(context.Background(), client, opts)
}

func runTaskRuntimeSessionGetWithClient(ctx context.Context, client *moltnetapi.Client, opts taskRuntimeSessionGetOpts) error {
	params, err := buildGetRuntimeSessionParams(opts)
	if err != nil {
		return err
	}
	res, err := client.GetRuntimeSession(ctx, params)
	if err != nil {
		return fmt.Errorf("task runtime-sessions get: %w", formatTransportError(err))
	}
	session, ok := res.(*moltnetapi.GetRuntimeSessionOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(opts.out, session)
}

func buildGetRuntimeSessionParams(opts taskRuntimeSessionGetOpts) (moltnetapi.GetRuntimeSessionParams, error) {
	taskID, teamID, err := parseRuntimeSessionIDs(opts.taskID, opts.teamID)
	if err != nil {
		return moltnetapi.GetRuntimeSessionParams{}, err
	}
	if opts.attemptN <= 0 {
		return moltnetapi.GetRuntimeSessionParams{}, fmt.Errorf("--attempt must be >= 1, got %d", opts.attemptN)
	}
	return moltnetapi.GetRuntimeSessionParams{
		TaskId:         taskID,
		AttemptN:       opts.attemptN,
		XMoltnetTeamID: teamID,
	}, nil
}

func runTaskRuntimeSessionUploadCmd(opts taskRuntimeSessionUploadOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskRuntimeSessionUploadWithClient(context.Background(), client, opts)
}

func runTaskRuntimeSessionUploadWithClient(ctx context.Context, client *moltnetapi.Client, opts taskRuntimeSessionUploadOpts) error {
	params, err := buildUploadRuntimeSessionParams(opts)
	if err != nil {
		return err
	}
	reader, closeReader, err := openInputFile(opts.file)
	if err != nil {
		return err
	}
	defer closeReader()

	res, err := client.UploadRuntimeSession(ctx, moltnetapi.UploadRuntimeSessionReq{Data: reader}, params)
	if err != nil {
		return fmt.Errorf("task runtime-sessions upload: %w", formatTransportError(err))
	}
	session, ok := res.(*moltnetapi.UploadRuntimeSessionOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSONTo(opts.out, session)
}

func buildUploadRuntimeSessionParams(opts taskRuntimeSessionUploadOpts) (moltnetapi.UploadRuntimeSessionParams, error) {
	taskID, teamID, err := parseRuntimeSessionIDs(opts.taskID, opts.teamID)
	if err != nil {
		return moltnetapi.UploadRuntimeSessionParams{}, err
	}
	if opts.attemptN <= 0 {
		return moltnetapi.UploadRuntimeSessionParams{}, fmt.Errorf("--attempt must be >= 1, got %d", opts.attemptN)
	}
	sessionKind, err := parseRuntimeSessionKind(opts.sessionKind)
	if err != nil {
		return moltnetapi.UploadRuntimeSessionParams{}, err
	}
	params := moltnetapi.UploadRuntimeSessionParams{
		TaskId:         taskID,
		AttemptN:       opts.attemptN,
		XMoltnetTeamID: teamID,
		SessionKind:    sessionKind,
	}
	if opts.parentSessionID != "" {
		id, err := uuid.Parse(opts.parentSessionID)
		if err != nil {
			return moltnetapi.UploadRuntimeSessionParams{}, fmt.Errorf("invalid --parent-session-id %q: %w", opts.parentSessionID, err)
		}
		params.ParentSessionId = moltnetapi.NewOptUUID(id)
	}
	if opts.sourceSlotID != "" {
		id, err := uuid.Parse(opts.sourceSlotID)
		if err != nil {
			return moltnetapi.UploadRuntimeSessionParams{}, fmt.Errorf("invalid --source-slot-id %q: %w", opts.sourceSlotID, err)
		}
		params.SourceSlotId = moltnetapi.NewOptUUID(id)
	}
	if opts.sourceRuntimeProfileID != "" {
		id, err := uuid.Parse(opts.sourceRuntimeProfileID)
		if err != nil {
			return moltnetapi.UploadRuntimeSessionParams{}, fmt.Errorf("invalid --source-runtime-profile-id %q: %w", opts.sourceRuntimeProfileID, err)
		}
		params.SourceRuntimeProfileId = moltnetapi.NewOptUUID(id)
	}
	return params, nil
}

func runTaskRuntimeSessionDownloadCmd(opts taskRuntimeSessionDownloadOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskRuntimeSessionDownloadWithClient(context.Background(), client, opts)
}

func runTaskRuntimeSessionDownloadWithClient(ctx context.Context, client *moltnetapi.Client, opts taskRuntimeSessionDownloadOpts) error {
	params, err := buildDownloadRuntimeSessionParams(opts)
	if err != nil {
		return err
	}
	writer, closeWriter, err := openOutputFile(opts.outFile, opts.out)
	if err != nil {
		return err
	}
	defer closeWriter()

	res, err := client.DownloadRuntimeSession(ctx, params)
	if err != nil {
		return fmt.Errorf("task runtime-sessions download: %w", formatTransportError(err))
	}
	download, ok := res.(*moltnetapi.DownloadRuntimeSessionOK)
	if !ok {
		return formatAPIError(res)
	}
	_, err = io.Copy(writer, download.Data)
	return err
}

func buildDownloadRuntimeSessionParams(opts taskRuntimeSessionDownloadOpts) (moltnetapi.DownloadRuntimeSessionParams, error) {
	taskID, teamID, err := parseRuntimeSessionIDs(opts.taskID, opts.teamID)
	if err != nil {
		return moltnetapi.DownloadRuntimeSessionParams{}, err
	}
	if opts.attemptN <= 0 {
		return moltnetapi.DownloadRuntimeSessionParams{}, fmt.Errorf("--attempt must be >= 1, got %d", opts.attemptN)
	}
	if opts.outFile == "" {
		return moltnetapi.DownloadRuntimeSessionParams{}, fmt.Errorf("--out is required")
	}
	return moltnetapi.DownloadRuntimeSessionParams{
		TaskId:         taskID,
		AttemptN:       opts.attemptN,
		XMoltnetTeamID: teamID,
	}, nil
}

func parseRuntimeSessionIDs(taskIDRaw, teamIDRaw string) (uuid.UUID, uuid.UUID, error) {
	taskID, err := uuid.Parse(taskIDRaw)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("invalid task ID %q: %w", taskIDRaw, err)
	}
	teamID, err := uuid.Parse(teamIDRaw)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("invalid --team-id %q: %w", teamIDRaw, err)
	}
	return taskID, teamID, nil
}

func parseRuntimeSessionKind(value string) (moltnetapi.UploadRuntimeSessionSessionKind, error) {
	switch value {
	case string(moltnetapi.UploadRuntimeSessionSessionKindRoot):
		return moltnetapi.UploadRuntimeSessionSessionKindRoot, nil
	case string(moltnetapi.UploadRuntimeSessionSessionKindExtend):
		return moltnetapi.UploadRuntimeSessionSessionKindExtend, nil
	case string(moltnetapi.UploadRuntimeSessionSessionKindFork):
		return moltnetapi.UploadRuntimeSessionSessionKindFork, nil
	case "":
		return "", fmt.Errorf("--session-kind is required")
	default:
		return "", fmt.Errorf("--session-kind must be one of root, extend, fork; got %q", value)
	}
}
