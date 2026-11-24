import { MockChat } from './mock-agent';

describe('MockChat', () => {
  it('answers after a delay and blocks a second question while answering', () => {
    let now = 0;
    const chat = new MockChat(() => now);
    const c = chat.start('r1', 'What should I fix first?');
    expect(c.messages!.map((m) => [m.role, m.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'pending'],
    ]);
    expect(chat.post(c.id, 'again')).toBe('busy');
    now += 5000;
    const answered = chat.get(c.id)!;
    expect(answered.messages![1].status).toBe('done');
    expect(answered.messages![1].content).toContain('Revoke the GitHub token');
    expect(chat.post(c.id, 'Explain the S3 bucket issue')).not.toBe('busy');
  });
});
