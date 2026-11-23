/// <reference types="vite/client" />

declare module "epubjs" {
  export interface NavItem {
    id?: string;
    href: string;
    label: string;
    subitems?: NavItem[];
  }

  export interface Location {
    start: {
      cfi: string;
      percentage?: number;
    };
  }

  export interface Rendition {
    display(target?: string): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    destroy(): void;
    on(event: string, callback: (...args: any[]) => void): void;
    currentLocation(): Location | Promise<Location>;
  }

  export interface Book {
    renderTo(
      element: HTMLElement,
      options?: Record<string, unknown>,
    ): Rendition;
    destroy(): void;
    loaded: {
      navigation: Promise<{ toc: NavItem[] }>;
    };
  }

  export default function ePub(url: string): Book;
}

declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const url: string;
  export default url;
}
