package miao

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const (
	incomingDirName = "incoming"
	partialRootName = ".tailcat-miao"
	partialVersion  = 1
)

// partialFile is one file in a resumable download. Got is the durable byte offset.
type partialFile struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Got    int64  `json:"got"`
}

// partialState is the sidecar written beside partial files and copied into the app incoming index.
type partialState struct {
	V       int           `json:"v"`
	ID      string        `json:"id"`
	Addr    string        `json:"addr"`
	Token   string        `json:"token"`
	Payload string        `json:"payload"`
	Dest    string        `json:"dest"`
	Files   []partialFile `json:"files"`
}

func partialFingerprint(addr, token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(addr) + "\n" + strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

func partialDir(dest, addr, token string) string {
	return filepath.Join(dest, partialRootName, partialFingerprint(addr, token))
}

func (st *partialState) dir() string {
	if st == nil {
		return ""
	}
	return partialDir(st.Dest, st.Addr, st.Token)
}

func (st *partialState) partPath(id string) string {
	return filepath.Join(st.dir(), id+".part")
}

func (st *partialState) find(id string) *partialFile {
	if st == nil {
		return nil
	}
	for i := range st.Files {
		if st.Files[i].ID == id {
			return &st.Files[i]
		}
	}
	return nil
}

func (st *partialState) bytesDone() int64 {
	if st == nil {
		return 0
	}
	var n int64
	for _, file := range st.Files {
		if file.Got > 0 {
			n += file.Got
		}
	}
	return n
}

func (st *partialState) bytesTotal() int64 {
	if st == nil {
		return 0
	}
	var n int64
	for _, file := range st.Files {
		if file.Size > 0 {
			n += file.Size
		}
	}
	return n
}

// prepare decides how much of a partial file can be kept. A length, size, or
// checksum mismatch drops that file so the next pull fetches it from the start.
func (st *partialState) prepare(item manifestItem) (int64, string) {
	path := st.partPath(item.id)
	_ = os.MkdirAll(st.dir(), 0o700)
	prev := st.find(item.id)
	if prev == nil || prev.Size != item.size || !shaAgrees(prev.SHA256, item.sha) || prev.Got < 0 || prev.Got > item.size {
		_ = os.Remove(path)
		return 0, path
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() != prev.Got {
		_ = os.Remove(path)
		return 0, path
	}
	return prev.Got, path
}

func shaAgrees(saved, next string) bool {
	if saved == "" || next == "" {
		return true
	}
	return strings.EqualFold(saved, next)
}

func (st *partialState) offsets() map[string]int64 {
	if st == nil {
		return nil
	}
	out := map[string]int64{}
	for _, file := range st.Files {
		if file.ID == "" || file.Got <= 0 {
			continue
		}
		if file.Size > 0 && file.Got > file.Size {
			continue
		}
		info, err := os.Stat(st.partPath(file.ID))
		if err != nil || info.Size() != file.Got {
			continue
		}
		out[file.ID] = file.Got
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (st *partialState) remember(files []*incomingFile) {
	if st == nil {
		return
	}
	next := make([]partialFile, 0, len(files))
	for _, file := range files {
		if file == nil {
			continue
		}
		next = append(next, partialFile{
			ID:     file.id,
			Name:   file.name,
			Size:   file.size,
			SHA256: file.sha,
			Got:    file.got,
		})
	}
	st.Files = next
}

func (st *partialState) save(indexRoot string) error {
	if st == nil || st.Dest == "" || st.Addr == "" || st.Token == "" {
		return nil
	}
	if st.V == 0 {
		st.V = partialVersion
	}
	dir := st.dir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := writeJSONAtomic(filepath.Join(dir, "state.json"), st); err != nil {
		return err
	}
	if indexRoot == "" {
		return nil
	}
	indexDir := filepath.Join(indexRoot, incomingDirName)
	if err := os.MkdirAll(indexDir, 0o700); err != nil {
		return err
	}
	return writeJSONAtomic(filepath.Join(indexDir, partialFingerprint(st.Addr, st.Token)+".json"), st)
}

func (st *partialState) remove(indexRoot string) {
	if st == nil {
		return
	}
	if st.Dest != "" && st.Addr != "" && st.Token != "" {
		dir := st.dir()
		_ = os.RemoveAll(dir)
		parent := filepath.Dir(dir)
		if entries, err := os.ReadDir(parent); err == nil && len(entries) == 0 {
			_ = os.Remove(parent)
		}
	}
	if indexRoot != "" && st.Addr != "" && st.Token != "" {
		_ = os.Remove(filepath.Join(indexRoot, incomingDirName, partialFingerprint(st.Addr, st.Token)+".json"))
	}
}

func loadPartial(dest, addr, token string) *partialState {
	path := filepath.Join(partialDir(dest, addr, token), "state.json")
	body, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var st partialState
	if err := json.Unmarshal(body, &st); err != nil || st.V != partialVersion {
		return nil
	}
	if st.Addr != addr || st.Token != token {
		return nil
	}
	st.Dest = dest
	return &st
}

func loadIncoming(root string) []partialState {
	entries, err := os.ReadDir(filepath.Join(root, incomingDirName))
	if err != nil {
		return nil
	}
	var out []partialState
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		body, err := os.ReadFile(filepath.Join(root, incomingDirName, entry.Name()))
		if err != nil {
			continue
		}
		var st partialState
		if err := json.Unmarshal(body, &st); err != nil || st.ID == "" || st.Dest == "" {
			continue
		}
		if loadPartial(st.Dest, st.Addr, st.Token) == nil {
			_ = os.Remove(filepath.Join(root, incomingDirName, entry.Name()))
			continue
		}
		out = append(out, st)
	}
	return out
}

func (st *partialState) job() ReceiveJob {
	files := make([]FileInfo, 0, len(st.Files))
	for _, file := range st.Files {
		files = append(files, FileInfo{Name: file.Name, Size: file.Size, SHA256: file.SHA256})
	}
	status := receiveInterrupted
	if st.bytesDone() <= 0 {
		status = receiveFailed
	}
	return ReceiveJob{
		ID:         st.ID,
		Status:     status,
		BytesDone:  st.bytesDone(),
		BytesTotal: st.bytesTotal(),
		Files:      files,
		Dest:       st.Dest,
		Payload:    st.Payload,
		Resumable:  st.bytesDone() > 0 || len(st.Files) > 0,
	}
}

func writeJSONAtomic(path string, value any) error {
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func parseResume(raw any) map[string]int64 {
	list, ok := raw.([]any)
	if !ok || len(list) == 0 {
		return nil
	}
	out := map[string]int64{}
	for _, entry := range list {
		obj, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		id, _ := obj["id"].(string)
		if id == "" {
			continue
		}
		off := asInt(obj["offset"])
		if off < 0 {
			continue
		}
		out[id] = off
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func cloneOffsets(in map[string]int64) map[string]int64 {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]int64, len(in))
	for id, off := range in {
		out[id] = off
	}
	return out
}
