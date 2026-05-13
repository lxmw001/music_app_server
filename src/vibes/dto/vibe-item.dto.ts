export class VibeSubCategoryDto {
  labelKey: string;
  promptLabel: string;
  icon?: string;
}

export class VibeItemDto {
  id: string;
  labelKey: string;
  promptLabel: string;
  subCategories: VibeSubCategoryDto[];
  icon?: string;
  order: number;
}
