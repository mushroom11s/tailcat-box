package tray

import "sync"

// mainQueue runs functions on a platform main thread.
// async must schedule drain on that thread and return without waiting for it.
// isMain reports whether the caller is already on that thread.
type mainQueue struct {
	mu     sync.Mutex
	q      []func()
	async  func()
	isMain func() bool
}

func (m *mainQueue) asyncCall(fn func()) {
	if m == nil || fn == nil {
		return
	}
	m.mu.Lock()
	m.q = append(m.q, fn)
	m.mu.Unlock()
	if m.async != nil {
		m.async()
	}
}

func (m *mainQueue) drain() {
	if m == nil {
		return
	}
	for {
		m.mu.Lock()
		if len(m.q) == 0 {
			m.mu.Unlock()
			return
		}
		fn := m.q[0]
		m.q = m.q[1:]
		m.mu.Unlock()
		fn()
	}
}

// syncCall runs fn on the main thread and waits until it returns.
// A call that is already on the main thread runs inline so a nested
// dispatch cannot deadlock the queue.
func (m *mainQueue) syncCall(fn func()) {
	if m == nil || fn == nil {
		return
	}
	if m.isMain != nil && m.isMain() {
		fn()
		return
	}
	done := make(chan struct{})
	m.asyncCall(func() {
		defer close(done)
		fn()
	})
	<-done
}
