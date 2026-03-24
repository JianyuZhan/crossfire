const NEAR_ZERO_MS = 10;
const MAX_DELTA_MS = 5000;

export interface PlaybackClock {
	readonly speed: number;
	readonly paused: boolean;
	setSpeed(multiplier: number): void;
	pause(): void;
	resume(): void;
	delay(originalDeltaMs: number): Promise<void>;
}

export class RealTimeClock implements PlaybackClock {
	readonly speed = 1;
	readonly paused = false;
	setSpeed(): void {}
	pause(): void {}
	resume(): void {}
	async delay(): Promise<void> {}
}

export class ScaledClock implements PlaybackClock {
	private _speed: number;
	private _paused = false;
	private resumeResolvers: Array<() => void> = [];

	constructor(speed = 1) {
		this._speed = speed;
	}

	get speed(): number {
		return this._speed;
	}
	get paused(): boolean {
		return this._paused;
	}

	setSpeed(multiplier: number): void {
		this._speed = multiplier;
	}

	pause(): void {
		this._paused = true;
	}

	resume(): void {
		this._paused = false;
		for (const resolve of this.resumeResolvers) resolve();
		this.resumeResolvers = [];
	}

	async delay(originalDeltaMs: number): Promise<void> {
		if (originalDeltaMs < NEAR_ZERO_MS) return;
		if (this._paused) {
			await new Promise<void>((resolve) => {
				this.resumeResolvers.push(resolve);
			});
		}
		const clamped = Math.min(originalDeltaMs, MAX_DELTA_MS);
		const scaledMs = clamped / this._speed;
		if (scaledMs < 1) return;
		await new Promise<void>((resolve) => setTimeout(resolve, scaledMs));
	}
}
