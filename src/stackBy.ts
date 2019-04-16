/**
 * Creates stacks of adjacent elements of an iterable based on a key
 * extractor function.
 * 
 * @param iterable Iterable with elements to be grouped.
 * @param by Key extraction function.
 * @yields Stacks of adjacent elements with identical keys.
 */
export function* stackBy<K,V>(iterable: V[], by: (
    currentValue: V,
    currentIndex: number,
    iterable: V[]
  ) => K) {

  let previous: K | null = null;
  let group: V[] = [];
  let currentIndex = 0;

  for (const element of iterable) {

    const key = by(element, currentIndex++, iterable);

    if (previous !== null && key !== previous) {
      yield group;
      group = [];
    }

    group.push(element);
    previous = key;

  }

  yield group;

}
