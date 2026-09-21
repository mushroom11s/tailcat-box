package store

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const settingsFile = "settings.json"

// Settings holds app-wide network options (CLI --region / --derpmap-url).
type Settings struct {
	Region     string `json:"region"`
	DERPMapURL string `json:"derpMapUrl"`
}

func (s *Store) settingsPath() string {
	return filepath.Join(s.Dir, settingsFile)
}

func (s *Store) LoadSettings() (Settings, error) {
	body, err := os.ReadFile(s.settingsPath())
	if err != nil {
		if os.IsNotExist(err) {
			return Settings{}, nil
		}
		return Settings{}, err
	}
	var out Settings
	if err := json.Unmarshal(body, &out); err != nil {
		return Settings{}, err
	}
	return out, nil
}

func (s *Store) SaveSettings(in Settings) error {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(in, "", "\t")
	if err != nil {
		return err
	}
	return os.WriteFile(s.settingsPath(), append(body, '\n'), 0o600)
}
