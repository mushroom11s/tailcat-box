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

var (
	ErrTooLarge = errors.New("This share is larger than 300 MiB.")
	ErrNeedFile = errors.New("Choose at least one file.")
	ErrFolder   = errors.New("Choose files, not folders.")
)

// Source is one file to stage. Path is copied from disk. Data is used when Path is empty.
type Source struct {
	Name string
	Path string
	Data []byte
}

// StagedFile is one copied object. StorageName is the on-disk name; Name is the original display name.
type StagedFile struct {
	Name        string
	StorageName string
	Path        string
	Size        int64
	SHA256      string
}

// Package is the temp directory for one share.
type Package struct {
	Dir   string
	Files []StagedFile
	Total int64
}

// Stage copies sources into dir using renamed storage files. dir is removed if staging fails.
func Stage(dir string, sources []Source) (*Package, error) {
	if len(sources) == 0 {
		return nil, ErrNeedFile
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
				return nil, err
			}
		}
		item := plannedFile{name: name}
		if src.Path != "" {
			info, err := os.Stat(src.Path)
			if err != nil {
				return nil, err
			}
			if info.IsDir() {
				return nil, ErrFolder
			}
			item.size = info.Size()
			item.path = src.Path
		} else {
			item.data = append([]byte(nil), src.Data...)
			item.size = int64(len(item.data))
		}
		total += item.size
		if total > MaxBytes {
			return nil, ErrTooLarge
		}
		planned = append(planned, item)
	}
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
		if pkg.Total > MaxBytes {
			_ = pkg.Remove()
			return nil, ErrTooLarge
		}
	}
	return pkg, nil
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
		if n > MaxBytes {
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
	if n != item.size && item.path == "" {
		// Byte sources must match the buffer we hashed. Path sizes can change
		// between Stat and read; the running total is checked by the caller.
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
