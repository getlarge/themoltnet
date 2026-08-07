package moltnetauthextension

import (
	"errors"
	"time"

	authn "github.com/getlarge/themoltnet/libs/moltnet-authn"
)

type Config struct {
	ProjectURL        string         `mapstructure:"project_url"`
	APIKey            string         `mapstructure:"api_key"`
	HydraAdminURL     string         `mapstructure:"hydra_admin_url"`
	TalosAdminURL     string         `mapstructure:"talos_admin_url"`
	KratosAdminURL    string         `mapstructure:"kratos_admin_url"`
	RequiredScopes    []string       `mapstructure:"required_scopes"`
	CacheTTL          *time.Duration `mapstructure:"cache_ttl"`
	CacheMaxEntries   *int           `mapstructure:"cache_max_entries"`
	RequestTimeout    *time.Duration `mapstructure:"request_timeout"`
	GlobalRate        float64        `mapstructure:"global_rate"`
	GlobalBurst       int            `mapstructure:"global_burst"`
	AgentRate         float64        `mapstructure:"agent_rate"`
	AgentBurst        int            `mapstructure:"agent_burst"`
	LimiterMaxEntries int            `mapstructure:"limiter_max_entries"`
	LimiterIdleTTL    time.Duration  `mapstructure:"limiter_idle_ttl"`
}

func (c *Config) withDefaults() {
	if c.CacheTTL == nil {
		value := authn.DefaultCacheTTL
		c.CacheTTL = &value
	}
	if c.CacheMaxEntries == nil {
		value := authn.DefaultCacheMaxEntries
		c.CacheMaxEntries = &value
	}
	if c.RequestTimeout == nil {
		value := authn.DefaultRequestTimeout
		c.RequestTimeout = &value
	}
	if len(c.RequiredScopes) == 0 {
		c.RequiredScopes = []string{authn.DefaultRequiredScope}
	}
	if c.GlobalRate == 0 {
		c.GlobalRate = 100
	}
	if c.GlobalBurst == 0 {
		c.GlobalBurst = 200
	}
	if c.AgentRate == 0 {
		c.AgentRate = 2
	}
	if c.AgentBurst == 0 {
		c.AgentBurst = 20
	}
	if c.LimiterMaxEntries == 0 {
		c.LimiterMaxEntries = 10_000
	}
	if c.LimiterIdleTTL == 0 {
		c.LimiterIdleTTL = 10 * time.Minute
	}
}

func (c *Config) Validate() error {
	c.withDefaults()
	if c.ProjectURL != "" && c.APIKey == "" {
		return errors.New("project_url requires api_key")
	}
	if c.ProjectURL == "" && c.APIKey != "" {
		return errors.New("self-hosted Ory configuration must not include api_key")
	}
	if c.ProjectURL == "" && (c.HydraAdminURL == "" || c.TalosAdminURL == "" || c.KratosAdminURL == "") {
		return errors.New("project_url or all three self-hosted admin URLs are required")
	}
	if *c.CacheTTL < 0 || *c.RequestTimeout <= 0 || *c.CacheMaxEntries <= 0 {
		return errors.New("cache and timeout bounds must be positive")
	}
	if c.GlobalRate <= 0 || c.GlobalBurst <= 0 || c.AgentRate <= 0 || c.AgentBurst <= 0 || c.LimiterMaxEntries <= 0 || c.LimiterIdleTTL <= 0 {
		return errors.New("rate limiter bounds must be positive")
	}
	return nil
}
