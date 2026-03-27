// src/lib/sanityImage.ts
import { getSanityClient } from './sanityClient';
import imageUrlBuilder from '@sanity/image-url';

const builder = imageUrlBuilder(getSanityClient());

export function urlFor(source: any) {
  return builder.image(source);
}