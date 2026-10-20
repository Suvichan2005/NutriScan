import {describe,it,expect} from 'vitest';
import {defaultProfile,hasUserContext,profileSchema} from '../contracts';

describe('optional session profile',()=>{
 it('starts with no inferred preferences, geography or health context',()=>{
  expect(profileSchema.parse(defaultProfile)).toEqual({dietaryPattern:'',allergiesIntolerances:'',healthConsiderations:'',goals:'',ageGroup:'',sexOrReferenceGroup:'',country:'',locality:''});
  expect(hasUserContext(defaultProfile)).toBe(false);
 });
 it('treats only nonblank user-entered values as context',()=>{
  expect(hasUserContext({...defaultProfile,healthConsiderations:'  '})).toBe(false);
  expect(hasUserContext({...defaultProfile,goals:'Check this product for a declared preference'})).toBe(true);
 });
 it('keeps user-declared categories separate and rejects legacy example fields',()=>{
  const input={...defaultProfile,dietaryPattern:'Plant-based',allergiesIntolerances:'Lactose intolerance',goals:'Compare added sugars'};
  expect(profileSchema.parse(input)).toMatchObject(input);
  expect(profileSchema.safeParse({...input,chapatis:8}).success).toBe(false);
 });
});
