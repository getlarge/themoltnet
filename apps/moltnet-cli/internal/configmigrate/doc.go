// Package configmigrate provides the durable mechanics for state-aware CLI
// configuration migrations.
//
// The engine and plan format are long-lived infrastructure. Concrete
// migrations belong to their feature package and may be removed after the
// oldest supported source version no longer needs them. Removing a migration
// therefore requires an explicit compatibility-boundary decision and the
// corresponding release-note and fixture updates.
package configmigrate
