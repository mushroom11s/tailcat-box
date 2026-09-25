package miao

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const MaxBytes int64 = 300 << 20

// copyLimit is the size at which a share stops being copied into app temp.
// Production uses MaxBytes. Tests in this package may set a smaller ceiling.
var copyLimit = MaxBytes

var (
	ErrTooLarge   = errors.New("This share is larger than 300 MiB.")
	ErrNeedFile   = errors.New("Choose at least one file.")
	ErrFolder     = errors.New("Choose files, not folders.")
	ErrOriginGone = errors.New("The original file was moved or deleted. Put it back in the same place, or end this share and start again.")
)

// Source is one file to stage. Path is read from disk. Data is used when Path is empty.
type Source struct {
	Name string
	Path string
	Data []byte
}

// StagedFile is one shared object. StorageName is the transfer id.
// For a copied share, Path is the temp file. For a by-reference share, Path
// and OriginPath are the absolute path the user picked.
type StagedFile struct {
	Name        string
	StorageName string
	Path        string
	Size        int64
	SHA256      string
	OriginPath  string
}

// Package is one share. ByRef shares keep the original files and only use Dir for metadata.
type Package struct {
	Dir   string
	Files []StagedFile
	Total int64
	ByRef bool
}

// Stage prepares sources for a share. Totals at or under copyLimit are copied
// into dir under random storage names. Larger totals of real files are kept
// at their original paths, one mode for the whole share. dir is removed if
// staging fails. Folders are rejected.
func Stage(dir string, sources []Source) (*Package, error) {
	planned, total, err := planSources(sources)
	if err != nil {
		return nil, err
	}
	if total > copyLimit {
		if !pathsOnly(planned) {
			return nil, ErrTooLarge
		}
		return stageByRef(dir, planned)
	}
	return stageCopies(dir, planned)
}

func (p *Package) Remove() error {
	if p == nil || p.Dir == "" {
		return nil
	}
	return os.RemoveAll(p.Dir)
}

type plannedFile struct {
	name string
	path string
	data []byte
	size int64
}

func planSources(sources []Source) ([]plannedFile, int64, error) {
	if len(sources) == 0 {
		return nil, 0, ErrNeedFile
	}
	planned := make([]plannedFile, 0, len(sources))
	var total int64
	for _, src := range sources {
		name, err := cleanDisplayName(src.Name)
		if err != nil {
			if src.Path != "" {
				name, err = cleanDisplayName(filepath.Base(src.Path))
			}
			if err != nil {
				return nil, 0, err
			}
		}
		item := plannedFile{name: name}
		if src.Path != "" {
			info, err := os.Stat(src.Path)
			if err != nil {
				return nil, 0, err
			}
			if info.IsDir() || !info.Mode().IsRegular() {
				return nil, 0, ErrFolder
			}
			item.size = info.Size()
			item.path = src.Path
		} else {
			item.data = append([]byte(nil), src.Data...)
			item.size = int64(len(item.data))
		}
		total += item.size
		planned = append(planned, item)
	}
	return planned, total, nil
}

func pathsOnly(planned []plannedFile) bool {
	if len(planned) == 0 {
		return false
	}
	for _, item := range planned {
		if item.path == "" {
			return false
		}
	}
	return true
}

func stageCopies(dir string, planned []plannedFile) (*Package, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	pkg := &Package{Dir: dir}
	for _, item := range planned {
		staged, err := copyOne(dir, item)
		if err != nil {
			_ = pkg.Remove()
			if errors.Is(err, ErrTooLarge) {
				return nil, ErrTooLarge
			}
			return nil, err
		}
		pkg.Files = append(pkg.Files, staged)
		pkg.Total += staged.Size
		if pkg.Total > copyLimit {
			_ = pkg.Remove()
			return nil, ErrTooLarge
		}
	}
	return pkg, nil
}

func stageByRef(dir string, planned []plannedFile) (*Package, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	pkg := &Package{Dir: dir, ByRef: true}
	for _, item := range planned {
		staged, err := referenceOne(item)
		if err != nil {
			_ = pkg.Remove()
			return nil, err
		}
		pkg.Files = append(pkg.Files, staged)
		pkg.Total += staged.Size
	}
	return pkg, nil
}

func referenceOne(item plannedFile) (StagedFile, error) {
	storage, err := randomName()
	if err != nil {
		return StagedFile{}, err
	}
	checked, err := checkOrigin(item.path, item.size, "")
	if err != nil {
		return StagedFile{}, err
	}
	checked.Name = item.name
	checked.StorageName = storage
	return checked, nil
}

// checkOrigin confirms path still names a regular file of the recorded size.
// An empty sum records the hash; a recorded sum must match.
func checkOrigin(path string, size int64, sum string) (StagedFile, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return StagedFile{}, ErrOriginGone
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return StagedFile{}, ErrOriginGone
	}
	info, err := os.Stat(abs)
	if err != nil || !info.Mode().IsRegular() {
		return StagedFile{}, ErrOriginGone
	}
	if size >= 0 && info.Size() != size {
		return StagedFile{}, ErrOriginGone
	}
	got, n, err := hashFile(abs)
	if err != nil || n != info.Size() || (size >= 0 && n != size) {
		return StagedFile{}, ErrOriginGone
	}
	if sum != "" && !strings.EqualFold(got, sum) {
		return StagedFile{}, ErrOriginGone
	}
	return StagedFile{
		Path:       abs,
		OriginPath: abs,
		Size:       n,
		SHA256:     got,
	}, nil
}

func recheckOrigins(files []StagedFile) ([]StagedFile, error) {
	out := make([]StagedFile, len(files))
	for i, file := range files {
		if strings.TrimSpace(file.SHA256) == "" || strings.TrimSpace(file.OriginPath) == "" {
			return nil, ErrOriginGone
		}
		checked, err := checkOrigin(file.OriginPath, file.Size, file.SHA256)
		if err != nil {
			return nil, err
		}
		if file.Name == "" || file.StorageName == "" {
			return nil, ErrOriginGone
		}
		checked.Name = file.Name
		checked.StorageName = file.StorageName
		out[i] = checked
	}
	return out, nil
}

func originBacked(files []StagedFile) bool {
	for _, file := range files {
		if file.OriginPath != "" {
			return true
		}
	}
	return false
}

func originReady(file StagedFile) error {
	if file.OriginPath == "" {
		return nil
	}
	info, err := os.Stat(file.Path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != file.Size {
		return ErrOriginGone
	}
	return nil
}

func copyOne(dir string, item plannedFile) (StagedFile, error) {
	storage, err := randomName()
	if err != nil {
		return StagedFile{}, err
	}
	dest := filepath.Join(dir, storage)
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return StagedFile{}, err
	}
	hash := sha256.New()
	var n int64
	write := func(r io.Reader) error {
		copied, err := io.Copy(io.MultiWriter(out, hash), r)
		n += copied
		if n > copyLimit {
			return ErrTooLarge
		}
		return err
	}
	var copyErr error
	if item.path != "" {
		in, err := os.Open(item.path)
		if err != nil {
			out.Close()
			return StagedFile{}, err
		}
		copyErr = write(in)
		in.Close()
	} else {
		copyErr = write(bytes.NewReader(item.data))
	}
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(dest)
		return StagedFile{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(dest)
		return StagedFile{}, closeErr
	}
	return StagedFile{
		Name:        item.name,
		StorageName: storage,
		Path:        dest,
		Size:        n,
		SHA256:      hex.EncodeToString(hash.Sum(nil)),
	}, nil
}

func randomName() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func cleanDisplayName(name string) (string, error) {
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("empty name")
	}
	return name, nil
}
