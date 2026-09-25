package adapter

import "sync"

// sshFan delivers interactive SSH output to late subscribers.
// Bytes published before the first subscriber are replayed.
type sshFan struct {
	mu     sync.Mutex
	replay [][]byte
	subs   map[int]*sshSub
	next   int
	closed bool
}

type sshSub struct {
	ch   chan []byte
	once sync.Once
}

func newSSHFan() *sshFan {
	return &sshFan{subs: map[int]*sshSub{}}
}

func (s *sshSub) close() {
	s.once.Do(func() { close(s.ch) })
}

func (s *sshSub) send(p []byte) {
	defer func() { _ = recover() }()
	s.ch <- p
}

func (f *sshFan) publish(p []byte) {
	if len(p) == 0 || f == nil {
		return
	}
	cp := append([]byte(nil), p...)
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return
	}
	if len(f.subs) == 0 {
		f.replay = append(f.replay, cp)
		if len(f.replay) > 256 {
			f.replay = f.replay[len(f.replay)-256:]
		}
		f.mu.Unlock()
		return
	}
	subs := make([]*sshSub, 0, len(f.subs))
	for _, sub := range f.subs {
		subs = append(subs, sub)
	}
	f.mu.Unlock()
	for _, sub := range subs {
		sub.send(cp)
	}
}

func (f *sshFan) subscribe() (<-chan []byte, func()) {
	ch := make(chan []byte, 64)
	sub := &sshSub{ch: ch}
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		close(ch)
		return ch, func() {}
	}
	id := f.next
	f.next++
	f.subs[id] = sub
	replay := f.replay
	f.replay = nil
	f.mu.Unlock()
	go func() {
		for _, p := range replay {
			sub.ch <- p
		}
	}()
	cancel := func() {
		f.mu.Lock()
		current, ok := f.subs[id]
		if ok {
			delete(f.subs, id)
		}
		f.mu.Unlock()
		if ok {
			current.close()
		}
	}
	return ch, cancel
}

func (f *sshFan) close() {
	if f == nil {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return
	}
	f.closed = true
	for id, sub := range f.subs {
		sub.close()
		delete(f.subs, id)
	}
}
