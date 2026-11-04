import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const query = jest.fn();

  beforeEach(async () => {
    query.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DataSource, useValue: { query } }],
    }).compile();
    appController = app.get<AppController>(AppController);
  });

  it('returns hello on root', () => {
    expect(appController.getHello()).toBe('Hello World!');
  });

  it('reports health and fails when the database is down', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    await expect(appController.health()).resolves.toEqual({ status: 'ok' });
    query.mockRejectedValue(new Error('connection refused'));
    await expect(appController.health()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
