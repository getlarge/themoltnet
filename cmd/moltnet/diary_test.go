package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestDiaryCreate(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/diary/entries" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck
		if body["content"] != "hello world" {
			t.Errorf("expected content=hello world, got %v", body["content"])
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"id": "entry-1", "content": "hello world"}) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	result, err := diaryCreate(client, map[string]interface{}{"content": "hello world"})

	// Assert
	if err != nil {
		t.Fatalf("diaryCreate() error: %v", err)
	}
	if result["id"] != "entry-1" {
		t.Errorf("expected id=entry-1, got %v", result["id"])
	}
}

func TestDiaryList(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/diary/entries" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"entries": []map[string]string{{"id": "e-1"}, {"id": "e-2"}},
			"total":   2,
		})
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	result, err := diaryList(client)

	// Assert
	if err != nil {
		t.Fatalf("diaryList() error: %v", err)
	}
	if result["total"] != float64(2) {
		t.Errorf("expected total=2, got %v", result["total"])
	}
}

func TestDiaryGet(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/diary/entries/entry-1" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"id": "entry-1"}) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	result, err := diaryGet(client, "entry-1")

	// Assert
	if err != nil {
		t.Fatalf("diaryGet() error: %v", err)
	}
	if result["id"] != "entry-1" {
		t.Errorf("expected id=entry-1, got %v", result["id"])
	}
}

func TestDiaryDelete(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/diary/entries/entry-1" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	if err := diaryDelete(client, "entry-1"); err != nil {
		t.Fatalf("diaryDelete() error: %v", err)
	}
}

func TestDiarySearch(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/diary/search" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck
		if body["query"] != "test query" {
			t.Errorf("expected query=test query, got %v", body["query"])
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"results": []interface{}{}}) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	result, err := diarySearch(client, "test query")

	// Assert
	if err != nil {
		t.Fatalf("diarySearch() error: %v", err)
	}
	if _, ok := result["results"]; !ok {
		t.Error("expected results key in response")
	}
}
