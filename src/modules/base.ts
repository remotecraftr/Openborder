import type { Finding } from '../types';
import type { Crawler } from '../crawler';

export abstract class BaseModule {
  abstract readonly moduleId: string;

  constructor(protected readonly crawler: Crawler) {}

  abstract run(): Promise<Finding[]>;
}
