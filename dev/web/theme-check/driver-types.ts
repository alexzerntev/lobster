export type ThemeCheckDriver = {
	setMode: (mode: "light" | "dark") => void;
	setFamily: (family: "claw" | "knot") => void;
	subscribe: (listener: () => void) => () => void;
	readonly notifications: number;
	dispose: () => void;
};
