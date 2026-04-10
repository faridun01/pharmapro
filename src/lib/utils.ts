import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function runRefreshTasks(...tasks: Array<() => void | Promise<unknown>>) {
  await Promise.all(tasks.map((task) => Promise.resolve(task())));
}
